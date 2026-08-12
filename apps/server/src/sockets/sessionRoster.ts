import {
  type AgentActivityPayload,
  type AgentModelPayload,
  type AgentSetModelPayload,
  type Session,
  type SessionStatusSnapshotPayload,
  SocketEvents,
  type ThinkingLevel,
  type UiCommand,
  type UiCommandPayload,
} from "@tangent/shared/contracts.ts";
import type { Server, Socket } from "socket.io";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import { parseThinkingLevel } from "../pi/agentConfig.ts";
import { type PiAgentManager, PRIME_AGENT_ID } from "../pi/piAgentManager.ts";
import type { SessionStore } from "../store/sessionStore.ts";
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

/** Reads Prime's persisted model/thinking selection, parsing the stored depth. */
async function loadPrimeOverride(
  store: SessionStore,
  sessionId: string,
): Promise<{ model?: string; thinkingDepth?: ThinkingLevel } | undefined> {
  const agents = await store.listAgents(sessionId);
  const prime = agents.find((agent) => agent.id === PRIME_AGENT_ID);
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
  pi.ensure(
    session.id,
    session.rootPath,
    undefined,
    primeOverride,
    session.user,
  );
  const persistedAgents = await store.listAgents(session.id);
  connectors.revive(session.id, persistedAgents);
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

/** Emits Prime's current resolved model/thinking to the joining socket. */
export function emitPrimeSelection(
  socket: Socket,
  pi: PiAgentManager,
  sessionId: string,
): void {
  const selection = pi.getAgentSelection(sessionId, PRIME_AGENT_ID);
  const payload: AgentModelPayload = {
    sessionId,
    agentId: PRIME_AGENT_ID,
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
