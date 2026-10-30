import path from "node:path";

import type { Resource } from "@tangent/shared/contracts.ts";
import type { RemoteAgentEvent } from "@tangent/shared/remoteSubagent.ts";
import type { Response } from "express";
import { z } from "zod";

import { SESSIONS_ROOT } from "../config.ts";
import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import { subagentAuthor } from "../connectors/participantAuthor.ts";
import type { ConversationRouter } from "../conversation/conversationRouter.ts";
import {
  applyResourceInput,
  readSessionResourceFile,
} from "../conversation/hostResources.ts";
import {
  homeConversationFor,
  orchestratorIdentity,
} from "../conversation/participantRegistry.ts";
import { catalogWorkspaceFiles } from "../conversation/workspaceFiles.ts";
import type { ExternalSubagentGateway } from "../external/externalSubagentGateway.ts";
import { channelUrl } from "../mcp/channelUrl.ts";
import { parseThinkingLevel } from "../pi/agentConfig.ts";
import type { ResourceGatewayDeps } from "../remote/remoteEnvironmentGateway.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { hostResourceInputSchema } from "./sessions/schemas.ts";

/**
 * How long a driver's poll is held open before it is answered empty. Well under
 * a proxy's idle timeout, so a parked poll is never cut off mid-request.
 */
export const DELIVERY_POLL_MS = 25_000;

/** Register body: create an external sub-agent tab with optional display meta. */
export const registerSchema = z.object({
  sessionId: z.string(),
  name: z.string(),
  template: z.string().optional(),
  model: z.string().optional(),
  thinkingDepth: z.string().optional(),
});
export type RegisterBody = z.infer<typeof registerSchema>;

/** Event body: a streamed event tagged with its tab; the event is passed through. */
export const eventSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  event: z.object({ type: z.string() }).passthrough(),
  /** The run the event belongs to; resolved from the tab when omitted. */
  runId: z.string().optional(),
});
export type EventBody = z.infer<typeof eventSchema>;

/** Run body: open a run for one turn of external work. */
export const runSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  /** The far side's own id for the work. */
  externalId: z.string().optional(),
  /** Where the far side's stream is being read from, to resume by. */
  cursor: z.string().optional(),
});
export type RunBody = z.infer<typeof runSchema>;

/** Run-end body: settle a run, recording how far its stream was read. */
export const runEndSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  status: z.enum(["completed", "cancelled", "failed"]),
  runId: z.string().optional(),
  cursor: z.string().optional(),
});
export type RunEndBody = z.infer<typeof runEndSchema>;

/** Status body: a lifecycle status change for an external sub-agent tab. */
export const statusSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  status: z.enum(["active", "completed", "killed", "error"]),
});
export type StatusBody = z.infer<typeof statusSchema>;

/**
 * Deliveries body: collect what is queued for a session's external tabs. A
 * single-agent driver (an ACP attach bridge) names its `agentId` so it only
 * ever sees its own work; a multi-agent driver omits it for the whole session.
 */
export const deliveriesSchema = z.object({
  sessionId: z.string(),
  agentId: z.string().optional(),
});
export type DeliveriesBody = z.infer<typeof deliveriesSchema>;

/** Report body: a proactive message an external tab posts to the orchestrator. */
export const reportSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  text: z.string().min(1),
});
export type ReportBody = z.infer<typeof reportSchema>;

/** The registered tab's id and the callback channel (null without a public URL). */
export interface RegisterResult {
  id: string;
  callback: { channelId: string; secret: string; url: string } | null;
}

/**
 * Registers a tab and resolves its id plus the callback channel its far side
 * dials back on. `callback` is null when this server has no public URL to hand
 * out: the tab is still usable, and the caller decides whether that is enough
 * for the runtime it drives.
 */
export async function registerExternalAgent(
  gateway: ExternalSubagentGateway,
  body: RegisterBody,
): Promise<RegisterResult> {
  const { id, callback } = await gateway.register(body.sessionId, {
    name: body.name,
    template: body.template,
    model: body.model,
    thinkingDepth: parseThinkingLevel(body.thinkingDepth),
  });
  const url = channelUrl(callback.channelId);
  return { id, callback: url ? { ...callback, url } : null };
}

/** Answers a register with the tab id and its callback channel. */
export function registerResponse(res: Response, result: RegisterResult): void {
  res.json({ subagent: { id: result.id }, callback: result.callback });
}

/**
 * Hands the session's queued messages to its driver. The driver holds the only
 * route to the runtime, so it asks for work rather than being dialed; a poll
 * that waits out its budget is answered empty and the driver asks again.
 */
export async function handleDeliveries(
  gateway: ExternalSubagentGateway,
  body: DeliveriesBody,
  res: Response,
  signal?: AbortSignal,
): Promise<void> {
  const deliveries = await gateway.takeDeliveries(
    body.sessionId,
    DELIVERY_POLL_MS,
    {
      agentId: body.agentId,
      signal,
    },
  );
  res.json({ deliveries });
}

/** Opens a run for a turn of external work, answering with its id. */
export function handleOpenRun(
  gateway: ExternalSubagentGateway,
  body: RunBody,
  res: Response,
): void {
  const runId = gateway.openRun(body.sessionId, body.agentId, {
    externalId: body.externalId,
    cursor: body.cursor,
  });
  if (!runId) {
    res.status(404).json({ error: "Unknown external sub-agent." });
    return;
  }
  res.json({ runId });
}

/** Settles a turn's run, recording how far its stream was read. */
export function handleRunEnd(
  gateway: ExternalSubagentGateway,
  body: RunEndBody,
  res: Response,
): void {
  gateway.endRun(body.sessionId, body.agentId, body.status, {
    runId: body.runId,
    cursor: body.cursor,
  });
  res.json({ ok: true });
}

/** Relays one streamed event into the sub-agent's tab. */
export function handleEvent(
  gateway: ExternalSubagentGateway,
  body: EventBody,
  res: Response,
): void {
  gateway.pushEvent(
    body.sessionId,
    body.agentId,
    body.event as unknown as RemoteAgentEvent,
    body.runId,
  );
  res.json({ ok: true });
}

/** Applies a lifecycle status change to a sub-agent tab. */
export function handleStatus(
  gateway: ExternalSubagentGateway,
  body: StatusBody,
  res: Response,
): void {
  gateway.setStatus(body.sessionId, body.agentId, body.status);
  res.json({ ok: true });
}

/**
 * Posts a message from a sub-agent to the session's orchestrator (Prime) in the
 * sub-agent's own thread, mentioning Prime so it wakes — the same path the
 * attach announce uses. The author is read from the roster the sub-agent appears
 * in, so a tab that is gone (no author) is a silent no-op.
 */
export async function postToOrchestrator(
  store: SessionStore,
  connectors: ConnectorRegistry,
  conversations: ConversationRouter,
  sessionId: string,
  agentId: string,
  content: string,
): Promise<void> {
  const author = subagentAuthor(connectors, sessionId, agentId);
  if (!author) return;
  const [conversationId, { orchestratorId }] = await Promise.all([
    homeConversationFor(store, sessionId, agentId),
    orchestratorIdentity(store, sessionId),
  ]);
  await conversations.post({
    sessionId,
    conversationId,
    author,
    content,
    mentions: [orchestratorId],
    ingress: "tool",
  });
}

/** Relays a sub-agent's proactive message to Prime, then acks. */
export async function handleReport(
  store: SessionStore,
  connectors: ConnectorRegistry,
  conversations: ConversationRouter,
  body: ReportBody,
  res: Response,
): Promise<void> {
  await postToOrchestrator(
    store,
    connectors,
    conversations,
    body.sessionId,
    body.agentId,
    body.text,
  );
  res.json({ ok: true });
}

/** Put-resource body: the session, the author sub-agent, and the host input. */
export const putResourceSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  input: hostResourceInputSchema,
});
export type PutResourceBody = z.infer<typeof putResourceSchema>;

/** List-resources body: the session whose catalogue to return. */
export const listResourcesSchema = z.object({
  sessionId: z.string(),
});
export type ListResourcesBody = z.infer<typeof listResourcesSchema>;

/** Read-resource body: a session-root-relative resource uri to fetch. */
export const readResourceSchema = z.object({
  sessionId: z.string(),
  uri: z.string().min(1),
});
export type ReadResourceBody = z.infer<typeof readResourceSchema>;

/**
 * Writes an attached agent's resource into the session catalog via the same
 * {@link applyResourceInput} path the HTTP and remote-env routes use: a `file`
 * input writes bytes under `uploads/`, a `host`/`memory` input catalogs its
 * entry. Attributes authorship to the token's `sub`, then refreshes the spawn
 * preamble and signals the room before answering with the stored resource.
 */
export async function handlePutResource(
  resources: ResourceGatewayDeps,
  author: string | undefined,
  body: PutResourceBody,
  res: Response,
): Promise<void> {
  const rootPath = path.join(SESSIONS_ROOT, body.sessionId);
  const resource = await applyResourceInput(
    resources.seed,
    body.sessionId,
    rootPath,
    body.input,
    author,
  );
  await resources.hostPreamble.refresh(body.sessionId);
  resources.emitResourcesUpdated(body.sessionId);
  res.status(201).json({ resource });
}

/**
 * Lists the session's catalogued resources. Scans the workspace first
 * (scan-then-list) so a file an agent just wrote is reflected, matching the HTTP
 * and remote-env list paths.
 */
export async function handleListResources(
  resources: ResourceGatewayDeps,
  body: ListResourcesBody,
  res: Response,
): Promise<void> {
  const rootPath = path.join(SESSIONS_ROOT, body.sessionId);
  await catalogWorkspaceFiles(resources.catalog, {
    id: body.sessionId,
    rootPath,
  });
  const list: Resource[] = await resources.catalog.listForSession(
    body.sessionId,
  );
  res.json({ resources: list });
}

/**
 * Reads one session resource's bytes by its uri, bounded strictly to the
 * session's `uploads/` or `artifacts/` subtree and capped at the per-file limit.
 */
export async function handleReadResource(
  body: ReadResourceBody,
  res: Response,
): Promise<void> {
  const rootPath = path.join(SESSIONS_ROOT, body.sessionId);
  const file = await readSessionResourceFile(rootPath, body.uri);
  res.json(file);
}
