import { PI_AGENT } from "@tangent/shared/contracts.ts";
import { type Response, Router } from "express";
import { z } from "zod";

import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import { parseThinkingLevel } from "../pi/agentConfig.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
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
});
export type SpawnInput = z.infer<typeof spawnSchema>;

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

/**
 * Spawns a sub-agent (resolving its model/thinking) and persists it so the
 * roster survives a restart. Extracted from the router so the route function
 * stays small.
 */
function handleSpawn(
  store: SessionStore,
  pi: PiAgentManager,
  body: SpawnInput,
  res: Response,
): void {
  try {
    const { info, tools, systemPrompt, autoRelayToPrime } = pi.spawnSubagent(
      body.sessionId,
      {
        name: body.name,
        template: body.template,
        systemPrompt: body.systemPrompt,
        tools: body.tools,
        model: body.model,
        thinkingDepth: parseThinkingLevel(body.thinkingDepth),
        task: body.task,
      },
    );
    void store.recordAgent(body.sessionId, {
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
    });
    res.json({ subagent: info });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}

/** Surfaces a Prime-issued directive in the sub-agent's transcript. */
function handleMessage(
  pi: PiAgentManager,
  body: MessageInput,
  res: Response,
): void {
  // Attributed to Prime (message_subagent is always a Prime-issued directive).
  pi.sendToAgent(body.sessionId, body.agentId, body.text, PI_AGENT);
  res.json({ ok: true });
}

/** Surfaces a sub-agent's report in its own thread and delivers it to Prime. */
function handleReport(
  pi: PiAgentManager,
  body: ReportInput,
  res: Response,
): void {
  // message_prime is a sub-agent-issued update; Prime reacts immediately.
  pi.reportToPrime(body.sessionId, body.agentId, body.text);
  res.json({ ok: true });
}

/** Terminates a sub-agent, optionally marking its work completed. */
function handleKill(pi: PiAgentManager, body: KillInput, res: Response): void {
  pi.killAgent(body.sessionId, body.agentId, body.completed ?? false);
  res.json({ ok: true });
}

/** Lists the sub-agents registered for a session. */
function handleList(pi: PiAgentManager, query: ListQuery, res: Response): void {
  res.json({ subagents: pi.listSubagents(query.sessionId) });
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
 * read the shared transcript. Guarded by a bearer token shared with the
 * spawned processes via env, so arbitrary local callers can't drive agents.
 */
export function createInternalAgentsRouter(
  store: SessionStore,
  pi: PiAgentManager,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  router.post("/spawn", validate({ body: spawnSchema }), (req, res) =>
    handleSpawn(store, pi, getValidated<SpawnInput>(req).body, res),
  );

  router.post("/message", validate({ body: messageSchema }), (req, res) =>
    handleMessage(pi, getValidated<MessageInput>(req).body, res),
  );

  router.post("/report", validate({ body: reportSchema }), (req, res) =>
    handleReport(pi, getValidated<ReportInput>(req).body, res),
  );

  router.post("/kill", validate({ body: killSchema }), (req, res) =>
    handleKill(pi, getValidated<KillInput>(req).body, res),
  );

  router.get("/list", validate({ query: listQuerySchema }), (req, res) =>
    handleList(pi, getValidated<unknown, unknown, ListQuery>(req).query, res),
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
