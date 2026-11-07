import type { BundleManifest } from "@tangent/shared/configBundle.ts";
import type {
  BundleReloadSummary,
  ReinstallBundleResponse,
  Session,
} from "@tangent/shared/contracts.ts";
import type { Request, Response, Router } from "express";

import {
  isAdmin,
  normalizeEmail,
  requestEmail,
} from "../../auth/permissions.ts";
import { ADMIN_EMAILS } from "../../config.ts";
import { orchestratorConversationFor } from "../../conversation/participantRegistry.ts";
import { isLockedPolicy } from "../../extensions/selection.ts";
import { getValidated, validate } from "../../middleware/validate.ts";
import type { ResolvedSessionConfig } from "../../pi/agentConfig.ts";
import {
  stageBundle,
  type StagedBundle,
} from "../../pi/config/bundleReinstall.ts";
import type { PiAgentManager, SessionReload } from "../../pi/piAgentManager.ts";
import type { TriggerEngine } from "../../pi/triggers/triggerEngine.ts";
import type { AgentBundleStore } from "../../store/agentBundleStore.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import {
  type ReinstallBundleInput,
  reinstallBundleSchema,
  type SessionParams,
  sessionParamsSchema,
} from "./schemas.ts";

/** Posts a non-waking system note into one of a session's Conversations. */
export type SystemNotePoster = (
  sessionId: string,
  conversationId: string,
  text: string,
) => Promise<void>;

export interface BundleReinstallDeps {
  store: SessionStore;
  pi: PiAgentManager;
  triggerEngine: TriggerEngine;
  agentBundleStore: AgentBundleStore;
  postSystemNote: SystemNotePoster;
  admins?: ReadonlySet<string>;
}

export const BUSY_MESSAGE =
  "Prime or a sub-agent is mid-run. Stop the run or wait for it to finish, then retry.";

/** Sessions with a reinstall in flight, so two never interleave their swaps. */
const reinstalling = new Set<string>();

/**
 * Who may reinstall: the session's owner (its creator, or anyone when the
 * session has none because auth is off) or an admin. A reinstall restarts
 * Prime, so membership on an open session is not enough.
 */
function canManageSession(
  session: Session,
  email: string | undefined,
  admins: ReadonlySet<string>,
): boolean {
  const owner = session.user?.email;
  if (!owner) return true;
  if (email && normalizeEmail(email) === normalizeEmail(owner)) return true;
  return admins.size > 0 && isAdmin(email, admins);
}

function versionChange(previous: string | undefined, next: string): string {
  return previous && previous !== next
    ? `${previous} → ${next}`
    : `${next} (reinstalled)`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The session note announcing a reinstall; Prime recovers context from it. */
export function reloadNote(summary: BundleReloadSummary, name: string): string {
  const parts = [
    `Bundle ${name} updated to ${versionChange(summary.previousVersion, summary.version)}.`,
  ];
  parts.push(
    summary.primeRestarted
      ? "Prime restarted with the new prompts, rules, skills and tools."
      : "Agents pick it up on their next start.",
  );
  if (summary.respawned.length > 0) {
    parts.push(`Restarted ${plural(summary.respawned.length, "sub-agent")}.`);
  }
  if (summary.stopped.length > 0) {
    const names = summary.stopped
      .map((agent) => `${agent.name} (template "${agent.template}")`)
      .join(", ");
    parts.push(`Stopped because their template was removed: ${names}.`);
  }
  return parts.join(" ");
}

/** Re-records respawned sub-agents' new spawn config and stopped ones' status,
 * so a later revive matches what is running. */
async function persistReload(
  store: SessionStore,
  sessionId: string,
  reload: SessionReload,
): Promise<void> {
  const rows = new Map(
    (await store.listAgents(sessionId)).map((row) => [row.id, row]),
  );
  for (const { info, tools, systemPrompt } of reload.respawned) {
    const row = rows.get(info.id);
    if (!row) continue;
    await store.recordAgent(sessionId, {
      ...row,
      model: info.model,
      thinkingDepth: info.thinkingDepth,
      tools,
      systemPrompt,
    });
  }
  for (const agent of reload.stopped) {
    await store.setAgentStatus(sessionId, agent.id, "killed");
  }
}

type Refusal = { status: number; error: string };

async function checkReinstallable(
  deps: BundleReinstallDeps,
  req: Request,
  session: Session,
  version: string | undefined,
): Promise<Refusal | undefined> {
  const admins = deps.admins ?? ADMIN_EMAILS;
  if (!canManageSession(session, requestEmail(req), admins)) {
    return {
      status: 403,
      error: "Only the session owner can reinstall its bundle",
    };
  }
  const refusal = await checkStoredVersion(deps, session, version);
  if (refusal) return refusal;
  if (reinstalling.has(session.id)) {
    return { status: 409, error: "A bundle reinstall is already in progress" };
  }
  if (deps.pi.isBusy(session.id)) return { status: 409, error: BUSY_MESSAGE };
  return undefined;
}

async function checkStoredVersion(
  deps: BundleReinstallDeps,
  session: Session,
  version: string | undefined,
): Promise<Refusal | undefined> {
  if (!session.config) {
    return { status: 409, error: "This session was not created from a bundle" };
  }
  const stored = await deps.agentBundleStore.get(session.config.id);
  if (!stored) {
    return {
      status: 404,
      error: `Bundle "${session.config.id}" is no longer stored`,
    };
  }
  if (version && version !== stored.version) {
    return {
      status: 409,
      error: `Version ${version} is not available; the stored version is ${stored.version}`,
    };
  }
  return undefined;
}

/**
 * Handles `POST /api/sessions/:id/bundle/reinstall`: re-installs the session's
 * stored bundle into its existing root (replacing only bundle-owned files),
 * records the new metadata, reconciles triggers and extension selection, and
 * respawns the session's Pi agents. Refused with `409` while any agent is
 * mid-run, checked both before staging and again right before the swap.
 */
export async function handleReinstallBundle(
  deps: BundleReinstallDeps,
  req: Request,
  id: string,
  input: ReinstallBundleInput,
  res: Response,
): Promise<void> {
  const session = await deps.store.getSession(id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const refusal = await checkReinstallable(deps, req, session, input.version);
  if (refusal) {
    res.status(refusal.status).json({ error: refusal.error });
    return;
  }

  reinstalling.add(id);
  try {
    await reinstall(deps, session, res);
  } finally {
    reinstalling.delete(id);
  }
}

/**
 * Stages the stored bundle and re-checks the busy gate just before the swap.
 * Answers the request itself and returns `undefined` when it cannot proceed.
 */
async function stageForSession(
  deps: BundleReinstallDeps,
  session: Session,
  res: Response,
): Promise<StagedBundle | undefined> {
  const bundleId = session.config?.id ?? "";
  const zip = await deps.agentBundleStore.readBundle(bundleId);
  if (!zip) {
    res.status(404).json({ error: `Bundle "${bundleId}" is no longer stored` });
    return undefined;
  }
  let staged: StagedBundle;
  try {
    staged = await stageBundle(zip, session.rootPath);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return undefined;
  }
  if (deps.pi.isBusy(session.id)) {
    await staged.discard();
    res.status(409).json({ error: BUSY_MESSAGE });
    return undefined;
  }
  return staged;
}

/** Applies a committed reinstall to the session's metadata, triggers,
 * extension selection and live agents. */
async function applyReinstall(
  deps: BundleReinstallDeps,
  session: Session,
  manifest: BundleManifest,
  config: ResolvedSessionConfig,
): Promise<{ updated: Session | undefined; summary: BundleReloadSummary }> {
  const { store } = deps;
  const updated = await store.attachConfig(session.id, {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    icon: manifest.icon,
  });
  if (isLockedPolicy(config.globalExtensions)) {
    await store.setSessionExtensions(session.id, undefined);
  }
  deps.triggerEngine.reseed(session.id, session.rootPath, manifest.triggers);

  const reload = deps.pi.reloadSession(session.id, config);
  await persistReload(store, session.id, reload);
  const summary: BundleReloadSummary = {
    previousVersion: session.config?.version,
    version: manifest.version,
    primeRestarted: reload.primeRestarted,
    respawned: reload.respawned.map(({ info }) => ({
      id: info.id,
      name: info.name,
    })),
    stopped: reload.stopped,
  };
  return { updated, summary };
}

async function reinstall(
  deps: BundleReinstallDeps,
  session: Session,
  res: Response,
): Promise<void> {
  const staged = await stageForSession(deps, session, res);
  if (!staged) return;

  let config: ResolvedSessionConfig;
  try {
    config = await staged.commit();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
    return;
  }
  const { updated, summary } = await applyReinstall(
    deps,
    session,
    staged.manifest,
    config,
  );
  await deps.postSystemNote(
    session.id,
    await orchestratorConversationFor(deps.store, session.id),
    reloadNote(summary, staged.manifest.name),
  );

  const response: ReinstallBundleResponse = {
    session: updated ?? session,
    reload: summary,
  };
  res.json(response);
}

export function registerBundleRoutes(
  router: Router,
  deps: BundleReinstallDeps,
): void {
  router.post(
    "/:id/bundle/reinstall",
    validate({ params: sessionParamsSchema, body: reinstallBundleSchema }),
    (req: Request, res: Response) => {
      const { params, body } = getValidated<
        ReinstallBundleInput,
        SessionParams
      >(req);
      return handleReinstallBundle(deps, req, params.id, body, res);
    },
  );
}
