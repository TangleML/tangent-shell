import {
  type AgentAbortPayload,
  type AgentSetModelPayload,
  type ArtifactPinPayload,
  type ArtifactUnpinPayload,
  type ChatAuthor,
  type ChatJoinPayload,
  type ChatMessagePayload,
  DEFAULT_USER,
  humanAuthor,
  type MemoryConfirmPayload,
  type MemoryDismissPayload,
  PI_AGENT,
  SocketEvents,
  type SubagentRosterPayload,
  type TriggerRosterPayload,
} from "@tangent/shared/contracts.ts";
import type { Server, Socket } from "socket.io";

import { resolveUserIdentity } from "../auth/identity.ts";
import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import type { ConversationRouter } from "../conversation/conversationRouter.ts";
import { orchestratorIdFor } from "../conversation/participantRegistry.ts";
import type { ParticipantService } from "../conversation/participantService.ts";
import type { MemoryManager } from "../pi/memory.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { TriggerEngine } from "../pi/triggers/triggerEngine.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import {
  handleArtifactPin,
  handleArtifactUnpin,
  replayArtifacts,
} from "./chatArtifacts.ts";
import {
  handleMemoryConfirm,
  handleMemoryDismiss,
  type MemoryRememberedHandler,
} from "./chatMemory.ts";
import { type MentionCandidate, resolveMentions } from "./mentions.ts";
import type { PresenceTracker } from "./presenceTracker.ts";
import { roomFor } from "./rooms.ts";
import {
  emitPrimeSelection,
  ensureSessionAgents,
  handleAgentSetModel,
  handleSessionStatusSubscribe,
  replayAgentActivities,
  type UiCommandEmitter,
} from "./sessionRoster.ts";

/** Shared dependencies wired into every connected socket's chat handlers. */
export interface ChatHandlerDeps {
  io: Server;
  store: SessionStore;
  pi: PiAgentManager;
  connectors: ConnectorRegistry;
  conversations: ConversationRouter;
  memory: MemoryManager;
  onRemembered: MemoryRememberedHandler;
  triggerEngine: TriggerEngine;
  emitUiCommand: UiCommandEmitter;
  participantService: ParticipantService;
  presence: PresenceTracker;
}

/**
 * Cancels a participant's Run through whichever connector holds it. The client
 * names the Run when it is tracking one; otherwise the connector cancels
 * whatever that participant has open. A refusal (a transport with no cancel
 * protocol, or nothing running) is logged rather than surfaced: the user asked
 * to stop something that isn't stoppable, and a system message in the thread
 * would be noise.
 */
function handleAgentAbort(
  connectors: ConnectorRegistry,
  payload: AgentAbortPayload,
): void {
  const sessionId = payload?.sessionId;
  const participantId = payload?.conversationId;
  if (!sessionId || !participantId) return;

  const { cancelled, reason } = connectors.cancelRun({
    sessionId,
    participantId,
    runId: payload.runId,
  });
  if (cancelled) return;
  console.log(`[runs] cancel refused for ${participantId}: ${reason}`);
}

/** Wires one connected socket's chat/agent/memory/artifact listeners. */
function wireSocket(socket: Socket, deps: ChatHandlerDeps): void {
  const { io, store, pi, connectors, memory } = deps;
  const { onRemembered, triggerEngine, emitUiCommand } = deps;

  // Resolved once per connection: the identity is the connection's, and the
  // client never gets a say in who its messages are attributed to.
  const author = resolveSocketAuthor(socket.handshake.headers.cookie);

  // (sessionId\0participantId) pairs whose presence this socket is holding up,
  // so the last of a person's tabs to close is what marks them detached.
  const tracked = new Set<string>();

  socket.on(SocketEvents.ChatJoin, (payload: ChatJoinPayload) => {
    void handleChatJoin(socket, store, pi, connectors, triggerEngine, payload);
    void markPresent(deps, author, payload?.sessionId, tracked);
  });

  socket.on("disconnect", () => markAbsent(deps, tracked));

  socket.on(SocketEvents.ChatMessage, (payload: ChatMessagePayload) =>
    handleChatMessage(socket, deps, author, payload),
  );

  socket.on(SocketEvents.AgentAbort, (payload: AgentAbortPayload) =>
    handleAgentAbort(connectors, payload),
  );

  socket.on(SocketEvents.AgentSetModel, (payload: AgentSetModelPayload) =>
    handleAgentSetModel(io, store, pi, payload),
  );

  socket.on(SocketEvents.MemoryConfirm, (payload: MemoryConfirmPayload) =>
    handleMemoryConfirm(store, connectors, memory, onRemembered, payload),
  );

  socket.on(SocketEvents.MemoryDismiss, (payload: MemoryDismissPayload) =>
    handleMemoryDismiss(store, connectors, memory, payload),
  );

  socket.on(SocketEvents.ArtifactPin, (payload: ArtifactPinPayload) =>
    handleArtifactPin(store, emitUiCommand, payload),
  );

  socket.on(SocketEvents.ArtifactUnpin, (payload: ArtifactUnpinPayload) =>
    handleArtifactUnpin(store, emitUiCommand, payload),
  );

  // Subscribe to the sessions lobby: join the shared room (so future status
  // changes broadcast here) and seed the socket with the current snapshot.
  socket.on(SocketEvents.SessionStatusSubscribe, () =>
    handleSessionStatusSubscribe(socket, pi),
  );

  // Terminal streaming channel is reserved for a later phase. Registered
  // here so the protocol is stable; it currently emits nothing.
  socket.on(SocketEvents.TerminalData, () => {
    // no-op stub
  });
}

/**
 * Registers chat (and a reserved terminal) handlers on the Socket.IO server.
 *
 * Clients join one room per session and receive history on join. Each session is
 * backed by a long-lived Pi agent process; a posted message is persisted,
 * broadcast to the room, and delivered to whoever reacts to it.
 */
export function registerChatHandlers(deps: ChatHandlerDeps): void {
  deps.io.on("connection", (socket: Socket) => wireSocket(socket, deps));
}

/** Joins the session room, then replays history and the sub-agent roster. */
async function handleChatJoin(
  socket: Socket,
  store: SessionStore,
  pi: PiAgentManager,
  connectors: ConnectorRegistry,
  triggerEngine: TriggerEngine,
  payload: ChatJoinPayload,
): Promise<void> {
  const session = await store.getSession(payload?.sessionId);
  if (!session) {
    socket.emit("error", { message: "Session not found" });
    return;
  }

  await socket.join(roomFor(session.id));

  // Lazily (re)spawn Prime and revive the session's sub-agents in case the
  // server restarted or the session predates the process manager.
  await ensureSessionAgents(store, pi, connectors, session);

  // Re-arm the session's schedule triggers (idempotent) and surface the roster.
  triggerEngine.sync(session.id, session.rootPath);

  const history = await store.getMessages(session.id);
  socket.emit(SocketEvents.ChatHistory, history);

  const roster: SubagentRosterPayload = {
    sessionId: session.id,
    subagents: connectors.list(session.id),
  };
  socket.emit(SocketEvents.SubagentRoster, roster);

  // Replay each live agent's current run-level activity for the joining client.
  replayAgentActivities(socket, pi, session.id);

  // Surface Prime's current model/thinking (the roster only tracks sub-agents).
  await emitPrimeSelection(socket, pi, store, session.id);

  const triggerRoster: TriggerRosterPayload = {
    sessionId: session.id,
    triggers: triggerEngine.list(session.id),
  };
  socket.emit(SocketEvents.TriggerRoster, triggerRoster);

  await replayArtifacts(socket, store, session.id);
}

/**
 * Who a message in this session can address: Prime plus every sub-agent any
 * connector holds. Names come from the live roster, so a mention resolves
 * against what the sender currently sees in the sidebar.
 */
function mentionCandidates(
  connectors: ConnectorRegistry,
  sessionId: string,
): MentionCandidate[] {
  return [
    { id: PI_AGENT.id, name: PI_AGENT.name },
    ...connectors
      .list(sessionId)
      .map((subagent) => ({ id: subagent.id, name: subagent.name })),
  ];
}

/**
 * The chat identity of whoever is on the other end of a socket, read from the
 * connection's own cookie rather than from anything the client sends. Falls back
 * to {@link DEFAULT_USER} when no JWT is configured or the cookie is absent —
 * the same fallback the UI uses, so both sides agree on the id and a message
 * still renders as your own.
 */
export function resolveSocketAuthor(cookieHeader: string | undefined) {
  return humanAuthor(resolveUserIdentity(cookieHeader) ?? DEFAULT_USER);
}

/** Key of the presence a socket holds for one participant in one session. */
function presenceKey(sessionId: string, participantId: string): string {
  return `${sessionId}\u0000${participantId}`;
}

/**
 * Marks a connecting human present, if they are an invited Participant of this
 * session. Only their first live socket transitions them to `connected`; a
 * non-participant (a session's owner who was never invited) has no presence.
 */
async function markPresent(
  deps: ChatHandlerDeps,
  author: ChatAuthor,
  sessionId: string | undefined,
  tracked: Set<string>,
): Promise<void> {
  if (author.kind !== "human" || !sessionId) return;
  const participant = await deps.participantService.get(sessionId, author.id);
  if (!participant) return;
  const key = presenceKey(sessionId, author.id);
  if (tracked.has(key)) return;
  tracked.add(key);
  if (deps.presence.arrive(sessionId, author.id))
    await deps.participantService.setPresence(
      sessionId,
      author.id,
      "connected",
    );
}

/** Marks a disconnecting socket's participants detached once their last tab closes. */
function markAbsent(deps: ChatHandlerDeps, tracked: Set<string>): void {
  for (const key of tracked) {
    const sep = key.indexOf("\u0000");
    const sessionId = key.slice(0, sep);
    const participantId = key.slice(sep + 1);
    if (deps.presence.depart(sessionId, participantId))
      void deps.participantService.setPresence(
        sessionId,
        participantId,
        "detached",
      );
  }
}

/**
 * Posts a human message into the conversation it was typed in. Whoever reacts to
 * it runs: Prime because a human talking in its thread is what it reacts to, a
 * sub-agent because the message landed in its own thread. No branch on which
 * conversation it was — that was the hardcoded routing this replaces.
 *
 * `pi.ensure` stays because it is lifecycle, not delivery: a cold session has no
 * Prime process for a reaction to reach.
 */
async function handleChatMessage(
  socket: Socket,
  deps: ChatHandlerDeps,
  author: ChatAuthor,
  payload: ChatMessagePayload,
): Promise<void> {
  const { store, pi, connectors, conversations } = deps;
  const session = await store.getSession(payload?.sessionId);
  if (!session) {
    socket.emit("error", { message: "Session not found" });
    return;
  }

  // Target thread: the orchestrator's by default, or a specific sub-agent so
  // users can steer it from its own tab.
  const orchestratorId = await orchestratorIdFor(store, session.id);
  const conversationId = payload.conversationId ?? orchestratorId;
  if (conversationId === orchestratorId)
    pi.ensure(session.id, session.rootPath);

  await conversations.post({
    sessionId: session.id,
    conversationId,
    author,
    content: payload.content,
    mentions: resolveMentions(
      payload.content,
      mentionCandidates(connectors, session.id),
    ),
    attachments: payload.attachments,
    delivery: payload.delivery ?? "auto",
  });
}
