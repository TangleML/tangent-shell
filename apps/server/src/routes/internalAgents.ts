import {
  connectorFields,
  type ConnectorKind,
  PI_AGENT,
} from "@tangent/shared/contracts.ts";
import { type Response, Router } from "express";
import { z } from "zod";

import type { A2aPeerGateway } from "../a2a/a2aPeerGateway.ts";
import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import { piCredential } from "../connectors/credentials.ts";
import { subagentAuthor } from "../connectors/participantAuthor.ts";
import type { ConversationRouter } from "../conversation/conversationRouter.ts";
import {
  homeConversationFor,
  orchestratorConversationFor,
  orchestratorIdFor,
} from "../conversation/participantRegistry.ts";
import type { ParticipantService } from "../conversation/participantService.ts";
import { reactionSpec } from "../conversation/reaction.ts";
import { requireCredential } from "../middleware/requireCredential.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import { parseThinkingLevel } from "../pi/agentConfig.ts";
import type { SessionStore } from "../store/sessionStore.ts";

/** Spawn a sub-agent; `sessionId` and `name` identify and label it. */
export const spawnSchema = z.object({
  sessionId: z.string(),
  name: z.string(),
  template: z.string().optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
  thinkingDepth: z.string().optional(),
  task: z.string().optional(),
  /** Where to host the sub-agent. Defaults to `local`. */
  environment: z.enum(["local", "remote"]).optional(),
});
export type SpawnInput = z.infer<typeof spawnSchema>;

/** Attach an A2A agent that already runs as a service, by its card's base URL. */
export const attachSchema = z.object({
  sessionId: z.string(),
  endpointUrl: z.url(),
  name: z.string().optional(),
  /**
   * Join the peer into the shared room — the orchestrator's Conversation, where
   * the humans are — as an opaque member woken when addressed, rather than
   * giving it only a private point-to-point thread.
   */
  sharedRoom: z.boolean().optional(),
});
export type AttachInput = z.infer<typeof attachSchema>;

/** Deliver a Prime-issued directive to a sub-agent. */
export const messageSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  text: z.string(),
});
export type MessageInput = z.infer<typeof messageSchema>;

/** A sub-agent's report back to Prime; same shape as a message. */
export const reportSchema = messageSchema;
export type ReportInput = z.infer<typeof reportSchema>;

/** Terminate a sub-agent, optionally marking its work completed. */
export const killSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  completed: z.boolean().optional(),
});
export type KillInput = z.infer<typeof killSchema>;

/** `?sessionId=` for listing a session's sub-agents. */
export const listQuerySchema = z.object({
  sessionId: z.string(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

/** `?sessionId=&limit=` for reading the shared transcript. */
export const roomQuerySchema = z.object({
  sessionId: z.string(),
  limit: z.string().optional(),
});
export type RoomQuery = z.infer<typeof roomQuerySchema>;

/** Default and maximum number of transcript messages `read_room` returns. */
const DEFAULT_ROOM_LIMIT = 30;
const MAX_ROOM_LIMIT = 200;

/** The connector a spawn request's `environment` names. */
function spawnKind(environment: SpawnInput["environment"]): ConnectorKind {
  return environment === "remote" ? "remote-env" : "pi-stdio";
}

/**
 * Spawns a sub-agent (resolving its model/thinking) on the connector its
 * requested environment names, persists it so the roster survives a restart, and
 * posts its initial task. The row is awaited before the task is posted, so the
 * sub-agent's Memberships are derived from its persisted facts rather than from
 * a default.
 */
async function handleSpawn(
  store: SessionStore,
  connectors: ConnectorRegistry,
  router: ConversationRouter,
  body: SpawnInput,
  res: Response,
): Promise<void> {
  const kind = spawnKind(body.environment);
  const connector = connectors.spawner(kind);
  if (!connector) {
    res.status(400).json({ error: `Cannot spawn a ${kind} sub-agent.` });
    return;
  }

  try {
    const { host } = connectorFields(kind);
    const { info, tools, systemPrompt, autoRelayToPrime } = connector.spawn(
      body.sessionId,
      {
        name: body.name,
        template: body.template,
        systemPrompt: body.systemPrompt,
        tools: body.tools,
        model: body.model,
        thinkingDepth: parseThinkingLevel(body.thinkingDepth),
        environment: host,
      },
    );
    await store.recordAgent(body.sessionId, {
      id: info.id,
      role: "subagent",
      name: info.name,
      purpose: body.task,
      status: "active",
      model: info.model,
      thinkingDepth: info.thinkingDepth,
      template: info.template,
      tools,
      systemPrompt,
      autoRelayToPrime,
      host,
      connector: info.connector,
      homeConversationId: info.conversationId,
    });
    res.json({ subagent: info });
    // Answered first: the sub-agent exists either way, and a failure to post its
    // first task must not read as a failed spawn Prime might retry.
    const fromConversation = await orchestratorConversationFor(
      store,
      body.sessionId,
    );
    await postDirective(
      router,
      body.sessionId,
      info.id,
      info.conversationId,
      body.task,
      fromConversation,
    ).catch((err: unknown) => {
      console.error(`[agents] initial task for ${info.id} failed:`, err);
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}

/**
 * Attaches an A2A agent to the session. Nothing is created: the agent already
 * runs somewhere, so this reads its Agent Card and records the tab. A card that
 * cannot be read is the request failing, not a tab that never works — which is
 * why, unlike a spawn, there is nothing to undo on the way out.
 */
async function handleAttach(
  a2a: A2aPeerGateway,
  store: SessionStore,
  participants: ParticipantService,
  body: AttachInput,
  res: Response,
): Promise<void> {
  try {
    const subagent = await a2a.attach(body.sessionId, {
      endpointUrl: body.endpointUrl,
      name: body.name,
    });
    if (body.sharedRoom) {
      const room = await orchestratorConversationFor(store, body.sessionId);
      await participants.join(body.sessionId, subagent.id, room, {
        reaction: reactionSpec("mentionsMe"),
        transcriptVisibility: "opaque",
      });
    }
    res.json({ subagent });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res
      .status(400)
      .json({ error: `Couldn't attach ${body.endpointUrl}: ${message}` });
  }
}

/**
 * Posts a Prime-issued directive into a sub-agent's Conversation, addressed to
 * it. Surfacing and delivery are the same act: the sub-agent reacts because it
 * was addressed, and the bubble the user reads is the Message that woke it.
 * Skips an empty or whitespace-only task.
 *
 * Prime writes this from its own Conversation, so it is a cross-Conversation
 * post: authorized by Prime's Membership in the sub-agent's thread, recorded as
 * having arrived from elsewhere, and kept inside the wave Prime is already in.
 */
async function postDirective(
  router: ConversationRouter,
  sessionId: string,
  agentId: string,
  conversationId: string,
  text: string | undefined,
  fromConversation: string,
): Promise<string | undefined> {
  if (!text?.trim()) return undefined;
  const { message, refused } = await router.postToConversation({
    sessionId,
    conversationId,
    fromConversation,
    author: PI_AGENT,
    content: text,
    mentions: [agentId],
    ingress: "tool",
  });
  // Nothing was posted at all: the refusal is about Prime, not the recipient.
  if (!message) return refused[0]?.reason;
  return refused.find((entry) => entry.participantId === agentId)?.reason;
}

/**
 * Posts a Prime-issued directive into the sub-agent's Conversation. Prime hears
 * about a sub-agent that did not wake, because a directive that reaches nobody
 * looks exactly like one that worked.
 */
async function handleMessage(
  store: SessionStore,
  router: ConversationRouter,
  body: MessageInput,
  res: Response,
): Promise<void> {
  const refused = await postDirective(
    router,
    body.sessionId,
    body.agentId,
    await homeConversationFor(store, body.sessionId, body.agentId),
    body.text,
    await orchestratorConversationFor(store, body.sessionId),
  );
  res.json({ ok: !refused, ...(refused ? { error: refused } : {}) });
}

/**
 * Posts a sub-agent's report into its own thread, addressed to Prime. A thin
 * alias over the same post `/message` makes: `message_prime` reaches Prime by
 * addressing it, not by a dedicated relay.
 */
async function handleReport(
  store: SessionStore,
  connectors: ConnectorRegistry,
  router: ConversationRouter,
  body: ReportInput,
  res: Response,
): Promise<void> {
  const { sessionId, agentId, text } = body;
  const author = subagentAuthor(connectors, sessionId, agentId);
  if (!author) {
    res.status(404).json({ error: "That sub-agent is no longer available." });
    return;
  }

  await router.post({
    sessionId,
    conversationId: await homeConversationFor(store, sessionId, agentId),
    author,
    content: text,
    mentions: [await orchestratorIdFor(store, sessionId)],
    ingress: "tool",
  });
  res.json({ ok: true });
}

/** Terminates a sub-agent, optionally marking its work completed. */
function handleKill(
  connectors: ConnectorRegistry,
  body: KillInput,
  res: Response,
): void {
  const { sessionId, agentId } = body;
  connectors
    .resolve(sessionId, agentId)
    .kill(sessionId, agentId, body.completed ?? false);
  res.json({ ok: true });
}

/** Lists the sub-agents registered for a session across every connector. */
function handleList(
  connectors: ConnectorRegistry,
  query: ListQuery,
  res: Response,
): void {
  res.json({ subagents: connectors.list(query.sessionId) });
}

/** Returns the tail of the shared transcript, clamped to the room limit. */
async function handleRoom(
  store: SessionStore,
  query: RoomQuery,
  res: Response,
): Promise<void> {
  const requested = Number(query.limit);
  const limit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(requested, MAX_ROOM_LIMIT)
      : DEFAULT_ROOM_LIMIT;

  const all = await store.getMessages(query.sessionId);
  res.json({ messages: all.slice(-limit) });
}

/**
 * Internal API used only by the orchestrator extension running inside each Pi
 * process. It lets Prime spawn/message/kill/list sub-agents and lets any agent
 * read the shared transcript. Guarded by the Pi connector's credential — the
 * token those processes inherited at spawn — so arbitrary local callers can't
 * drive agents.
 */
export function createInternalAgentsRouter(
  store: SessionStore,
  connectors: ConnectorRegistry,
  conversations: ConversationRouter,
  a2a: A2aPeerGateway,
  participants: ParticipantService,
): Router {
  const router = Router();

  router.use(requireCredential(piCredential));

  router.post("/spawn", validate({ body: spawnSchema }), (req, res) =>
    handleSpawn(
      store,
      connectors,
      conversations,
      getValidated<SpawnInput>(req).body,
      res,
    ),
  );

  router.post("/attach", validate({ body: attachSchema }), (req, res) =>
    handleAttach(
      a2a,
      store,
      participants,
      getValidated<AttachInput>(req).body,
      res,
    ),
  );

  router.post("/message", validate({ body: messageSchema }), (req, res) =>
    handleMessage(
      store,
      conversations,
      getValidated<MessageInput>(req).body,
      res,
    ),
  );

  router.post("/report", validate({ body: reportSchema }), (req, res) =>
    handleReport(
      store,
      connectors,
      conversations,
      getValidated<ReportInput>(req).body,
      res,
    ),
  );

  router.post("/kill", validate({ body: killSchema }), (req, res) =>
    handleKill(connectors, getValidated<KillInput>(req).body, res),
  );

  router.get("/list", validate({ query: listQuerySchema }), (req, res) =>
    handleList(
      connectors,
      getValidated<unknown, unknown, ListQuery>(req).query,
      res,
    ),
  );

  router.get("/room", validate({ query: roomQuerySchema }), (req, res) =>
    handleRoom(
      store,
      getValidated<unknown, unknown, RoomQuery>(req).query,
      res,
    ),
  );

  return router;
}
