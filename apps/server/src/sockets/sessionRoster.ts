import {
  type AgentActivityPayload,
  type AgentModelPayload,
  type AgentSetModelPayload,
  isTerminalStatus,
  type Session,
  type SessionStatusSnapshotPayload,
  SocketEvents,
  type SubagentInfo,
  type ThinkingLevel,
  type UiCommand,
  type UiCommandPayload,
} from "@tangent/shared/contracts.ts";
import type { Server, Socket } from "socket.io";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import {
  orchestratorConversationFor,
  orchestratorIdentity,
} from "../conversation/participantRegistry.ts";
import { parseThinkingLevel } from "../pi/agentConfig.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { SessionAgent, SessionStore } from "../store/sessionStore.ts";
import { roomFor, SESSIONS_LOBBY } from "./rooms.ts";

/**
 * Pushes a generic agent->UI directive into a session room. This is the single
 * transport every UI-affecting feature shares: callers build a {@link UiCommand}
 * variant (e.g. `session.update`) and this broadcasts it; clients dispatch by
 * `command.kind` and ignore kinds they don't recognize.
 */
export type UiCommandEmitter = (sessionId: string, command: UiCommand) => void;

/** Builds the {@link UiCommandEmitter} bound to the Socket.IO server. */
export function createUiCommandEmitter(io: Server): UiCommandEmitter {
  return (sessionId, command) => {
    const payload: UiCommandPayload = { sessionId, command };
    io.to(roomFor(sessionId)).emit(SocketEvents.UiCommand, payload);
  };
}

/**
 * Applies a human-requested model/thinking change: respawns the target agent's
 * Pi process with the new settings, persists the selection so it survives a
 * restart, and surfaces it. Sub-agent changes ride the roster-update handler
 * (fired inside {@link PiAgentManager.setAgentModel}); Prime's change is
 * broadcast here via the dedicated `agent:model` event.
 */
export function handleAgentSetModel(
  io: Server,
  store: SessionStore,
  pi: PiAgentManager,
  payload: AgentSetModelPayload,
): void {
  if (!payload) return;
  const { sessionId, agentId, model, thinkingDepth } = payload;
  if (!sessionId || !agentId) return;

  const result = pi.setAgentModel(sessionId, agentId, { model, thinkingDepth });
  if (!result) return;

  persistAndBroadcastSelection(io, store, sessionId, result);
}

/** Persists an agent's new selection and broadcasts it (Prime only). */
function persistAndBroadcastSelection(
  io: Server,
  store: SessionStore,
  sessionId: string,
  result: NonNullable<ReturnType<PiAgentManager["setAgentModel"]>>,
): void {
  void store.recordAgent(sessionId, {
    id: result.info.id,
    role: result.role,
    name: result.info.name,
    status: "active",
    model: result.info.model,
    thinkingDepth: result.info.thinkingDepth,
    template: result.info.template,
  });

  // Sub-agent changes already broadcast via the roster-update handler fired
  // inside setAgentModel; Prime has no roster entry, so emit its own event.
  if (result.role !== "prime") return;
  const out: AgentModelPayload = {
    sessionId,
    agentId: result.info.id,
    model: result.info.model,
    thinkingDepth: result.info.thinkingDepth,
  };
  io.to(roomFor(sessionId)).emit(SocketEvents.AgentModel, out);
}

/** Reads the orchestrator's persisted model/thinking selection. */
async function loadPrimeOverride(
  store: SessionStore,
  sessionId: string,
): Promise<{ model?: string; thinkingDepth?: ThinkingLevel } | undefined> {
  const agents = await store.listAgents(sessionId);
  const prime = agents.find((agent) =>
    agent.capabilities.includes("orchestrator"),
  );
  if (!prime) return undefined;
  return {
    model: prime.model,
    thinkingDepth: parseThinkingLevel(prime.thinkingDepth),
  };
}

/**
 * (Re)spawns the session's Prime — restoring any persisted model/thinking
 * selection — and revives its persisted sub-agents through their own connectors,
 * so a restart restores the full agent set (not just Prime). Idempotent: agents
 * already live are skipped.
 */
export async function ensureSessionAgents(
  store: SessionStore,
  pi: PiAgentManager,
  connectors: ConnectorRegistry,
  session: Session,
): Promise<void> {
  const primeOverride = await loadPrimeOverride(store, session.id);
  const primaryConversationId = await orchestratorConversationFor(
    store,
    session.id,
  );
  const env = await store.getSessionEnv(session.id);
  await pi.ensure(session.id, session.rootPath, {
    primeOverride,
    user: session.user,
    homeConversationId: primaryConversationId,
    env,
  });
  const persistedAgents = await store.listAgents(session.id);
  connectors.revive(session.id, persistedAgents);
}

/** A finished sub-agent that stays in the roster until a user dismisses it. */
export function isDismissible(agent: SessionAgent): boolean {
  return (
    agent.role === "subagent" &&
    isTerminalStatus(agent.status) &&
    !agent.dismissedAt
  );
}

/** The roster entry a persisted, no-longer-live sub-agent reads back as. */
function finishedSubagentInfo(agent: SessionAgent): SubagentInfo {
  const thinkingDepth = parseThinkingLevel(agent.thinkingDepth);
  return {
    id: agent.id,
    conversationId: agent.homeConversationId,
    name: agent.name,
    status: agent.status,
    connector: agent.connector,
    ...(agent.template ? { template: agent.template } : {}),
    ...(agent.model ? { model: agent.model } : {}),
    ...(thinkingDepth ? { thinkingDepth } : {}),
    createdAt: agent.createdAt,
  };
}

/**
 * Every live sub-agent plus the finished, undismissed ones connectors no longer
 * hold, so a reload keeps them. A live entry wins over its persisted row.
 */
export async function subagentRoster(
  store: SessionStore,
  connectors: ConnectorRegistry,
  sessionId: string,
): Promise<SubagentInfo[]> {
  const persisted = await store.listAgents(sessionId);
  const dismissed = new Set(
    persisted.filter((agent) => agent.dismissedAt).map((agent) => agent.id),
  );
  const live = connectors
    .list(sessionId)
    .filter((subagent) => !dismissed.has(subagent.id));
  const liveIds = new Set(live.map((subagent) => subagent.id));
  const finished = persisted
    .filter((agent) => isDismissible(agent) && !liveIds.has(agent.id))
    .map(finishedSubagentInfo);
  return [...live, ...finished];
}

/**
 * Replays each live agent's current run-level activity to the joining socket, so
 * a client reconnecting mid-run sees the in-progress tool call / "thinking"
 * indicator and bubble instead of them going blank until the next event.
 */
export function replayAgentActivities(
  socket: Socket,
  pi: PiAgentManager,
  sessionId: string,
): void {
  for (const { conversationId, activity } of pi.listActivities(sessionId)) {
    const payload: AgentActivityPayload = {
      sessionId,
      conversationId,
      activity,
    };
    socket.emit(SocketEvents.AgentActivity, payload);
  }
}

/** Emits the orchestrator's current resolved model/thinking to the socket. */
export async function emitPrimeSelection(
  socket: Socket,
  pi: PiAgentManager,
  store: SessionStore,
  sessionId: string,
): Promise<void> {
  const orchestratorId = (await orchestratorIdentity(store, sessionId))
    .orchestratorId;
  const selection = pi.getAgentSelection(sessionId, orchestratorId);
  const payload: AgentModelPayload = {
    sessionId,
    agentId: orchestratorId,
    model: selection?.model,
    thinkingDepth: selection?.thinkingDepth,
  };
  socket.emit(SocketEvents.AgentModel, payload);
}

/**
 * Joins the shared sessions lobby and replies with the current status snapshot,
 * so a list view reflects every session's run status immediately and stays live
 * via later `session:status` broadcasts. Sessions absent from the snapshot are
 * `idle`.
 */
export async function handleSessionStatusSubscribe(
  socket: Socket,
  pi: PiAgentManager,
): Promise<void> {
  await socket.join(SESSIONS_LOBBY);
  const payload: SessionStatusSnapshotPayload = { statuses: pi.getStatuses() };
  socket.emit(SocketEvents.SessionStatusSnapshot, payload);
}
