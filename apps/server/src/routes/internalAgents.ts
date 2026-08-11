import { PI_AGENT, type SubagentHost } from "@tangent/shared/contracts.ts";
import { type Response, Router } from "express";
import { z } from "zod";

import type { ExternalSubagentGateway } from "../external/externalSubagentGateway.ts";
import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import {
  parseThinkingLevel,
  type SubagentSpawnRequest,
} from "../pi/agentConfig.ts";
import type { PiAgentManager, SpawnedSubagent } from "../pi/piAgentManager.ts";
import type { RemoteEnvironmentGateway } from "../remote/remoteEnvironmentGateway.ts";
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
 * The hosts a sub-agent can be routed to. `pi` (local) and `remote` are
 * spawnable via `spawn_subagent`; `external` sub-agent tabs are created and
 * driven by a bundle tool over `/internal/external-agents`, so the external
 * gateway is present here only to merge its roster into `list`.
 */
interface AgentHosts {
  pi: PiAgentManager;
  remote: RemoteEnvironmentGateway;
  external: ExternalSubagentGateway;
}

/** Narrows a spawn request's `environment` to a concrete {@link SubagentHost}. */
function resolveHost(environment: SpawnInput["environment"]): SubagentHost {
  return environment === "remote" ? "remote" : "local";
}

/** Spawns a sub-agent on its requested host (local Pi or remote env). */
function spawnOnHost(
  hosts: AgentHosts,
  sessionId: string,
  request: SubagentSpawnRequest,
  host: SubagentHost,
): SpawnedSubagent {
  if (host === "remote") return hosts.remote.spawnSubagent(sessionId, request);
  return hosts.pi.spawnSubagent(sessionId, request);
}

/**
 * Spawns a sub-agent (resolving its model/thinking) on the requested host and
 * persists it so the roster survives a restart. Extracted from the router so
 * the route function stays small.
 */
function handleSpawn(
  store: SessionStore,
  hosts: AgentHosts,
  body: SpawnInput,
  res: Response,
): void {
  try {
    const host = resolveHost(body.environment);
    const { info, tools, systemPrompt, autoRelayToPrime } = spawnOnHost(
      hosts,
      body.sessionId,
      {
        name: body.name,
        template: body.template,
        systemPrompt: body.systemPrompt,
        tools: body.tools,
        model: body.model,
        thinkingDepth: parseThinkingLevel(body.thinkingDepth),
        task: body.task,
        environment: host,
      },
      host,
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
      host,
      connector: info.connector,
    });
    res.json({ subagent: info });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}

/** Surfaces a Prime-issued directive in the sub-agent's transcript. */
function handleMessage(
  hosts: AgentHosts,
  body: MessageInput,
  res: Response,
): void {
  // Attributed to Prime (message_subagent is always a Prime-issued directive).
  // Remote-hosted sub-agents route through their gateway; else local.
  const { sessionId, agentId, text } = body;
  if (hosts.remote.hasAgent(sessionId, agentId)) {
    hosts.remote.sendToAgent(sessionId, agentId, text, PI_AGENT);
  } else {
    hosts.pi.sendToAgent(sessionId, agentId, text, PI_AGENT);
  }
  res.json({ ok: true });
}

/** Surfaces a sub-agent's report in its own thread and delivers it to Prime. */
function handleReport(
  hosts: AgentHosts,
  body: ReportInput,
  res: Response,
): void {
  // message_prime is a sub-agent-issued update; Prime reacts immediately.
  hosts.pi.reportToPrime(body.sessionId, body.agentId, body.text);
  res.json({ ok: true });
}

/** Terminates a sub-agent, optionally marking its work completed. */
function handleKill(hosts: AgentHosts, body: KillInput, res: Response): void {
  const { sessionId, agentId } = body;
  const completed = body.completed ?? false;
  if (hosts.remote.hasAgent(sessionId, agentId)) {
    hosts.remote.killAgent(sessionId, agentId, completed);
  } else {
    hosts.pi.killAgent(sessionId, agentId, completed);
  }
  res.json({ ok: true });
}

/** Lists the sub-agents registered for a session across all hosts. */
function handleList(hosts: AgentHosts, query: ListQuery, res: Response): void {
  res.json({
    subagents: [
      ...hosts.pi.listSubagents(query.sessionId),
      ...hosts.remote.listSubagents(query.sessionId),
      ...hosts.external.listSubagents(query.sessionId),
    ],
  });
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
  remoteGateway: RemoteEnvironmentGateway,
  externalGateway: ExternalSubagentGateway,
): Router {
  const router = Router();
  const hosts: AgentHosts = {
    pi,
    remote: remoteGateway,
    external: externalGateway,
  };

  router.use(requireInternalToken);

  router.post("/spawn", validate({ body: spawnSchema }), (req, res) =>
    handleSpawn(store, hosts, getValidated<SpawnInput>(req).body, res),
  );

  router.post("/message", validate({ body: messageSchema }), (req, res) =>
    handleMessage(hosts, getValidated<MessageInput>(req).body, res),
  );

  router.post("/report", validate({ body: reportSchema }), (req, res) =>
    handleReport(hosts, getValidated<ReportInput>(req).body, res),
  );

  router.post("/kill", validate({ body: killSchema }), (req, res) =>
    handleKill(hosts, getValidated<KillInput>(req).body, res),
  );

  router.get("/list", validate({ query: listQuerySchema }), (req, res) =>
    handleList(
      hosts,
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
