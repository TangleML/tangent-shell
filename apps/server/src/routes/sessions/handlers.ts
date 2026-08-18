import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  Attachment,
  Session,
  SessionActivity,
  UploadFilesResponse,
} from "@tangent/shared/contracts.ts";
import type { Request, Response } from "express";
import multer from "multer";

import { resolveUserIdentity } from "../../auth/identity.ts";
import {
  ARTIFACTS_DIRNAME,
  SESSIONS_ROOT,
  UPLOADS_DIRNAME,
} from "../../config.ts";
import type { PiAgentManager } from "../../pi/piAgentManager.ts";
import type { TriggerEngine } from "../../pi/triggers/triggerEngine.ts";
import type { AgentBundleStore } from "../../store/agentBundleStore.ts";
import { readActivity } from "../../store/chatLog.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import { injectPageBridge } from "./pageBridge.ts";
import {
  provisionSession,
  SessionProvisioningError,
} from "./provisionSession.ts";
import type {
  CreateSessionInput,
  SessionParams,
  UpdateSessionInput,
} from "./schemas.ts";
import {
  isUnsafeId,
  isWithin,
  loadSession,
  sanitizeFilename,
} from "./utils.ts";

/**
 * Streams uploaded chat attachments straight to the session's `uploads/` folder.
 * The destination is derived from the `:id` route param (validated for traversal
 * before multer runs); stored filenames are prefixed with random bytes so two
 * uploads of the same name never collide. The original name is preserved in the
 * returned {@link Attachment} metadata.
 */
export const uploadFiles = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const id = (req.params as { id?: string }).id ?? "";
      if (isUnsafeId(id)) {
        cb(new Error("Invalid session id"), "");
        return;
      }
      const dir = path.join(SESSIONS_ROOT, id, UPLOADS_DIRNAME);
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename: (_req, file, cb) => {
      const prefix = randomBytes(4).toString("hex");
      cb(null, `${prefix}-${sanitizeFilename(file.originalname)}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/**
 * Serves agent-produced artifacts for a session. The workspace path is
 * deterministic (`SESSIONS_ROOT/<id>`) and artifacts persist on disk, so this
 * keys off the id directly rather than the (volatile, in-memory) session
 * record — letting artifacts stay servable across server restarts.
 *
 * The splat is the path relative to the workspace root (e.g.
 * `artifacts/chart.png` or `uploads/report.csv`), so it resolves against the
 * root and then validates the result stays within the `artifacts/` or
 * `uploads/` subtree. `sendFile` derives the Content-Type from the extension,
 * so images render and HTML pages (plus their relative assets) resolve under
 * the same `/files/` prefix.
 */
export function createArtifactFileHandler() {
  return (
    req: Request<{ id: string; splat: string[] }>,
    res: Response,
  ): void => {
    const id = req.params.id;
    if (isUnsafeId(id)) {
      res.status(400).json({ error: "Invalid session id" });
      return;
    }

    const splat = req.params.splat;
    const rel = Array.isArray(splat) ? splat.join("/") : String(splat ?? "");

    const rootPath = path.join(SESSIONS_ROOT, id);
    const artifactsDir = path.join(rootPath, ARTIFACTS_DIRNAME);
    const uploadsDir = path.join(rootPath, UPLOADS_DIRNAME);
    const target = path.resolve(rootPath, rel);
    if (!isWithin(target, artifactsDir) && !isWithin(target, uploadsDir)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    serveArtifact(res, rootPath, rel, target);
  };
}

/**
 * Sends a validated artifact. HTML gets the page bridge injected so its forms
 * can fire trigger callbacks through the sandboxed frame's parent; everything
 * else streams via `sendFile`, which derives the Content-Type from the extension
 * and only applies its dotfile check to the path after `root`.
 */
function serveArtifact(
  res: Response,
  rootPath: string,
  rel: string,
  target: string,
): void {
  if (/\.html?$/i.test(rel)) {
    fs.readFile(target, "utf8", (err, html) => {
      if (err) res.status(404).end();
      else res.type("html").send(injectPageBridge(html));
    });
    return;
  }

  res.sendFile(rel, { root: rootPath }, (err) => {
    if (err) res.status(404).end();
  });
}

/** Handles `POST /api/sessions`. */
export async function handleCreateSession(
  store: SessionStore,
  pi: PiAgentManager,
  triggerEngine: TriggerEngine,
  agentBundleStore: AgentBundleStore,
  req: Request,
  body: CreateSessionInput,
  res: Response,
): Promise<void> {
  try {
    const session = await provisionSession(
      { store, pi, triggerEngine, agentBundleStore },
      {
        ...body,
        user: resolveUserIdentity(req.headers.cookie) ?? undefined,
      },
    );
    res.status(201).json({ session });
  } catch (error) {
    if (error instanceof SessionProvisioningError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
}

/**
 * Maps multer's stored files to {@link Attachment} metadata. `filename` is the
 * (uniquified) on-disk name; `originalname` is what the user picked and is what
 * the UI shows. Paths are workspace-relative so the agent and file API agree.
 */
function toAttachments(files: Express.Multer.File[]): Attachment[] {
  return files.map((file) => ({
    name: file.originalname,
    path: `${UPLOADS_DIRNAME}/${file.filename}`,
    contentType: file.mimetype,
    size: file.size,
  }));
}

/** Handles `POST /api/sessions/:id/files`: records uploaded chat attachments. */
export async function handleUploadFiles(
  store: SessionStore,
  req: Request<SessionParams>,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, req.params.id);
  if (!session) return;

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const response: UploadFilesResponse = { files: toAttachments(files) };
  res.status(201).json(response);
}

/** Read-state key: the viewer's email, or `"local"` when no identity resolves. */
function resolveUserKey(req: Request): string {
  return resolveUserIdentity(req.headers.cookie)?.email ?? "local";
}

/** Computes the requesting user's {@link SessionActivity} for one session. */
async function activityFor(
  store: SessionStore,
  session: Session,
  lastViewedAt: string | undefined,
): Promise<SessionActivity> {
  const [{ unreadCount, lastActivityAt }, agents] = await Promise.all([
    readActivity(session.rootPath, lastViewedAt),
    store.listAgents(session.id),
  ]);
  return {
    unreadCount,
    lastActivityAt,
    hasError: agents.some((agent) => agent.status === "error"),
    activeAgentCount: agents.filter(
      (agent) => agent.role !== "prime" && agent.status === "active",
    ).length,
  };
}

/** Handles `GET /api/sessions`, attaching each session's per-viewer activity. */
export async function handleListSessions(
  store: SessionStore,
  req: Request,
  res: Response,
): Promise<void> {
  const [list, viewed] = await Promise.all([
    store.listSessions(),
    store.getLastViewedMap(resolveUserKey(req)),
  ]);
  const sessions = await Promise.all(
    list.map(async (session) => ({
      ...session,
      activity: await activityFor(store, session, viewed.get(session.id)),
    })),
  );
  res.json({ sessions });
}

/** Handles `POST /api/sessions/:id/viewed`: records the viewer's read state. */
export async function handleMarkSessionViewed(
  store: SessionStore,
  req: Request,
  id: string,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, id);
  if (!session) return;
  await store.markViewed(id, resolveUserKey(req), new Date().toISOString());
  res.status(204).end();
}

/** Handles `GET /api/sessions/:id`. */
export async function handleGetSession(
  store: SessionStore,
  id: string,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, id);
  if (!session) return;
  res.json({ session });
}

/** Handles `PATCH /api/sessions/:id`. */
export async function handleUpdateSession(
  store: SessionStore,
  id: string,
  body: UpdateSessionInput,
  res: Response,
): Promise<void> {
  const session = await store.updateSession(id, {
    name: body.name,
    archived: body.archived,
  });
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ session });
}

/** Handles `DELETE /api/sessions/:id`. */
export async function handleDeleteSession(
  store: SessionStore,
  pi: PiAgentManager,
  triggerEngine: TriggerEngine,
  id: string,
  res: Response,
): Promise<void> {
  const deleted = await store.deleteSession(id);
  if (!deleted) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  pi.dispose(id);
  triggerEngine.dispose(id);
  res.status(204).end();
}
