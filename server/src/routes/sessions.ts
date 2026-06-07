import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  Attachment,
  CreateSessionRequest,
  SessionConfigMeta,
  UpdateSessionRequest,
  UploadFilesResponse,
} from "@shared/contracts.ts";
import { type Request, type Response, Router } from "express";
import multer from "multer";

import { ARTIFACTS_DIRNAME, SESSIONS_ROOT, UPLOADS_DIRNAME } from "../config.ts";
import { installBundle } from "../pi/config/bundleLoader.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { AgentBundleStore } from "../store/agentBundleStore.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { bundleUpload } from "./bundleUpload.ts";

/** Strips path separators/dotfiles from a filename so it can't escape `uploads/`. */
function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[/\\]/g, "_");
  const cleaned = base.replace(/^\.+/, "").trim();
  return cleaned || "file";
}

/**
 * Streams uploaded chat attachments straight to the session's `uploads/` folder.
 * The destination is derived from the `:id` route param (validated for traversal
 * before multer runs); stored filenames are prefixed with random bytes so two
 * uploads of the same name never collide. The original name is preserved in the
 * returned {@link Attachment} metadata.
 */
const uploadFiles = multer({
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
  limits: { fileSize: 10 * 1024 * 1024 },
});

/** Rejects ids that aren't a single, traversal-free path segment. */
function isUnsafeId(id: string): boolean {
  return id.includes("/") || id.includes("\\") || id.includes("..");
}

/** True when `target` is `dir` itself or sits inside it. */
function isWithin(target: string, dir: string): boolean {
  return target === dir || target.startsWith(dir + path.sep);
}

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
function createArtifactFileHandler() {
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

    // Serve relative to the session root: `send` only applies its dotfile
    // check to the path after `root`, so the `.sessions` root dir doesn't
    // trip it up. `sendFile` derives the Content-Type from the extension.
    res.sendFile(rel, { root: rootPath }, (err) => {
      if (err) res.status(404).end();
    });
  };
}

/**
 * Provisions a new session from an uploaded Configuration Bundle: installs it
 * into the session root, records its metadata, and spawns Prime with the
 * resolved per-session config. On an invalid bundle the just-created session is
 * removed so a failed upload leaves nothing half-provisioned.
 */
async function createSessionFromBundle(
  store: SessionStore,
  pi: PiAgentManager,
  sessionId: string,
  rootPath: string,
  zipBuffer: Buffer,
  res: Response,
): Promise<void> {
  try {
    const { manifest, config } = await installBundle(zipBuffer, rootPath);
    const meta: SessionConfigMeta = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      icon: manifest.icon,
    };
    const withConfig = await store.attachConfig(sessionId, meta);
    pi.ensure(sessionId, rootPath, config);
    res.status(201).json({ session: withConfig });
  } catch (err) {
    await store.deleteSession(sessionId);
    res.status(400).json({ error: (err as Error).message });
  }
}

/**
 * Resolves the bundle ZIP a create request should install: an uploaded `config`
 * multipart file, or a marketplace bundle referenced by `bundleId`. Returns
 * `undefined` when no bundle was requested and `"not-found"` when a `bundleId`
 * doesn't resolve, so the caller can answer `404` before creating a session.
 */
async function resolveCreateBundle(
  req: Request,
  body: CreateSessionRequest,
  agentBundleStore: AgentBundleStore,
): Promise<Buffer | "not-found" | undefined> {
  if (req.file) return req.file.buffer;
  if (!body.bundleId) return undefined;
  return (await agentBundleStore.readBundle(body.bundleId)) ?? "not-found";
}

/**
 * Handles `POST /api/sessions`. A session can be created plain, from an
 * uploaded bundle ZIP (`config` multipart field), or from a marketplace agent
 * bundle (`bundleId`); the latter two share the {@link createSessionFromBundle}
 * install path.
 */
async function handleCreateSession(
  store: SessionStore,
  pi: PiAgentManager,
  agentBundleStore: AgentBundleStore,
  req: Request,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as CreateSessionRequest;

  // Resolve any bundle before creating the session so a bad id fails without
  // leaving an empty session behind.
  const zipBuffer = await resolveCreateBundle(req, body, agentBundleStore);
  if (zipBuffer === "not-found") {
    res.status(404).json({ error: "Agent bundle not found" });
    return;
  }

  const session = await store.createSession({ name: body.name });

  if (zipBuffer) {
    await createSessionFromBundle(
      store,
      pi,
      session.id,
      session.rootPath,
      zipBuffer,
      res,
    );
    return;
  }

  // No bundle: spawn the session's Pi agent with the global config so it's
  // ready when the chat opens.
  pi.ensure(session.id, session.rootPath);
  res.status(201).json({ session });
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
async function handleUploadFiles(
  store: SessionStore,
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  const session = await store.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const response: UploadFilesResponse = { files: toAttachments(files) };
  res.status(201).json(response);
}

/** Handles `GET /api/sessions/:id`. */
async function handleGetSession(
  store: SessionStore,
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  const session = await store.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ session });
}

/** Handles `PATCH /api/sessions/:id`. */
async function handleUpdateSession(
  store: SessionStore,
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as UpdateSessionRequest;
  const session = await store.updateSession(req.params.id, { name: body.name });
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ session });
}

/** Handles `DELETE /api/sessions/:id`. */
async function handleDeleteSession(
  store: SessionStore,
  pi: PiAgentManager,
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  const deleted = await store.deleteSession(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  pi.dispose(req.params.id);
  res.status(204).end();
}

export function createSessionsRouter(
  store: SessionStore,
  pi: PiAgentManager,
  agentBundleStore: AgentBundleStore,
): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    const sessions = await store.listSessions();
    res.json({ sessions });
  });

  // `bundleUpload.single` parses a multipart `config` ZIP (form field `name`
  // lands in `req.body`); plain JSON requests pass through untouched (parsed
  // earlier by the global `express.json()`), so both content types hit the same
  // handler.
  router.post(
    "/",
    bundleUpload.single("config"),
    (req: Request, res: Response) =>
      handleCreateSession(store, pi, agentBundleStore, req, res),
  );

  router.get("/:id", (req: Request<{ id: string }>, res: Response) =>
    handleGetSession(store, req, res),
  );

  router.patch("/:id", (req: Request<{ id: string }>, res: Response) =>
    handleUpdateSession(store, req, res),
  );

  router.delete("/:id", (req: Request<{ id: string }>, res: Response) =>
    handleDeleteSession(store, pi, req, res),
  );

  // Uploads land in the session's `uploads/` folder; `uploadFiles.array` writes
  // each file to disk before the handler records the resulting metadata.
  router.post(
    "/:id/files",
    uploadFiles.array("files"),
    (req: Request<{ id: string }>, res: Response) =>
      handleUploadFiles(store, req, res),
  );

  router.get("/:id/files/*splat", createArtifactFileHandler());

  return router;
}
