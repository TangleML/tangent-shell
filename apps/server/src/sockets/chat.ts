import { randomUUID } from "node:crypto";

import {
  type AgentAbortPayload,
  type AgentActivity,
  type AgentActivityPayload,
  type AgentDeltaPayload,
  type AgentEndPayload,
  type AgentErrorPayload,
  type AgentModelPayload,
  type AgentQueuePayload,
  type AgentSetModelPayload,
  type AgentStartPayload,
  type AgentThinkingPayload,
  type ArtifactPinPayload,
  type ArtifactUnpinPayload,
  type Attachment,
  type ChatAuthor,
  type ChatJoinPayload,
  type ChatMessage,
  type ChatMessagePayload,
  MEMORY_AUTHOR,
  type MemoryConfirmPayload,
  type MemoryDismissPayload,
  type MemoryScope,
  type MemorySuggestionPayload,
  PI_AGENT,
  type Session,
  type SessionStatusPayload,
  type SessionStatusSnapshotPayload,
  SocketEvents,
  type SubagentRosterPayload,
  type SubagentUpdatePayload,
  type ThinkingLevel,
  type TriggerRosterPayload,
  type UiCommand,
  type UiCommandPayload,
} from "@tangent/shared/contracts.ts";
import type { Server, Socket } from "socket.io";

import { parseThinkingLevel } from "../pi/agentConfig.ts";
import type { MemoryManager } from "../pi/memory.ts";
import {
  type AgentDescriptor,
  type AgentEvent,
  type AgentEventHandler,
  type AgentMessageHandler,
  type PiAgentManager,
  PRIME_AGENT_ID,
  type SubagentUpdateHandler,
} from "../pi/piAgentManager.ts";
import type { TriggerEngine } from "../pi/triggers/triggerEngine.ts";
import type { SessionStatusHandler } from "../pi/types.ts";
import type { RemoteEnvironmentGateway } from "../remote/remoteEnvironmentGateway.ts";
import type {
  SessionAgentStatus,
  SessionStore,
} from "../store/sessionStore.ts";

function roomFor(sessionId: string): string {
  return `session:${sessionId}`;
}

/**
 * Shared room every client viewing a session list (the switcher, the sessions
 * table) joins to receive live run-status updates for all sessions at once,
 * without subscribing to each session's individual room.
 */
const SESSIONS_LOBBY = "sessions:lobby";

/**
 * Builds the {@link SessionStatusHandler} that fans status changes out to the
 * lobby room, so every list view reflects a session's run status live.
 */
export function createSessionStatusHandler(io: Server): SessionStatusHandler {
  return (sessionId, status) => {
    const payload: SessionStatusPayload = { sessionId, status };
    io.to(SESSIONS_LOBBY).emit(SocketEvents.SessionStatus, payload);
  };
}

function buildMessage(
  id: string,
  sessionId: string,
  conversationId: string,
  author: ChatAuthor,
  content: string,
  thinking?: string,
  attachments?: Attachment[],
): ChatMessage {
  return {
    id,
    sessionId,
    conversationId,
    author,
    content,
    ...(thinking ? { thinking } : {}),
    ...(attachments && attachments.length ? { attachments } : {}),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Appends a list of attached files (by their workspace-relative path) to the
 * human's message before it is handed to the agent, so the agent knows the
 * files exist and can read them with its own file tools. Returns the content
 * unchanged when nothing was attached.
 */
function promptWithAttachments(
  content: string,
  attachments?: Attachment[],
): string {
  if (!attachments || attachments.length === 0) return content;
  const list = attachments.map((a) => `- ${a.path}`).join("\n");
  const intro =
    "The user attached the following files (paths are relative to your workspace):";
  return content ? `${content}\n\n${intro}\n${list}` : `${intro}\n${list}`;
}

/** Resolves the chat author for an agent: Prime is fixed, sub-agents per id. */
function authorFor(agent: AgentDescriptor): ChatAuthor {
  if (agent.role === "prime") return PI_AGENT;
  return {
    id: agent.agentId,
    kind: "agent",
    name: agent.name,
    agentRole: "subagent",
  };
}

/** Shared context for emitting one agent event into its session room. */
interface EmitContext {
  room: string;
  sessionId: string;
  conversationId: string;
  author: ChatAuthor;
}

function emitStart(io: Server, ctx: EmitContext, messageId: string): void {
  const message = buildMessage(
    messageId,
    ctx.sessionId,
    ctx.conversationId,
    ctx.author,
    "",
  );
  const payload: AgentStartPayload = { message };
  io.to(ctx.room).emit(SocketEvents.AgentStart, payload);
}

function emitDelta(
  io: Server,
  ctx: EmitContext,
  event: { messageId: string; delta: string },
): void {
  const payload: AgentDeltaPayload = {
    sessionId: ctx.sessionId,
    messageId: event.messageId,
    delta: event.delta,
  };
  io.to(ctx.room).emit(SocketEvents.AgentDelta, payload);
}

function emitThinking(
  io: Server,
  ctx: EmitContext,
  event: { messageId: string; delta: string },
): void {
  const payload: AgentThinkingPayload = {
    sessionId: ctx.sessionId,
    messageId: event.messageId,
    delta: event.delta,
  };
  io.to(ctx.room).emit(SocketEvents.AgentThinking, payload);
}

function emitEnd(
  io: Server,
  store: SessionStore,
  ctx: EmitContext,
  event: { messageId: string; content: string; thinking: string },
): void {
  const message = buildMessage(
    event.messageId,
    ctx.sessionId,
    ctx.conversationId,
    ctx.author,
    event.content,
    event.thinking,
  );
  // Persist before broadcasting so reconnecting clients see it in history.
  void store.appendMessage(message).then(() => {
    const payload: AgentEndPayload = { message };
    io.to(ctx.room).emit(SocketEvents.AgentEnd, payload);
  });
}

function emitError(
  io: Server,
  ctx: EmitContext,
  event: { messageId?: string; message: string },
): void {
  const payload: AgentErrorPayload = {
    sessionId: ctx.sessionId,
    messageId: event.messageId,
    message: event.message,
  };
  io.to(ctx.room).emit(SocketEvents.AgentError, payload);
}

function emitActivity(
  io: Server,
  ctx: EmitContext,
  activity: AgentActivity | null,
): void {
  const payload: AgentActivityPayload = {
    sessionId: ctx.sessionId,
    conversationId: ctx.conversationId,
    activity,
  };
  io.to(ctx.room).emit(SocketEvents.AgentActivity, payload);
}

function emitQueue(
  io: Server,
  ctx: EmitContext,
  event: { steering: string[]; followUp: string[] },
): void {
  const payload: AgentQueuePayload = {
    sessionId: ctx.sessionId,
    conversationId: ctx.conversationId,
    steering: event.steering,
    followUp: event.followUp,
  };
  io.to(ctx.room).emit(SocketEvents.AgentQueue, payload);
}

/**
 * Builds the handler that relays agents' streaming events to the matching
 * session room, dispatching each event variant to its emit helper.
 *
 * Each message is tagged with the producing agent's id as its `conversationId`
 * so the client can bucket it into the right transcript (Prime's main thread or
 * a sub-agent's drill-in thread). Reasoning streams for every agent.
 */
export function createAgentEventHandler(
  io: Server,
  store: SessionStore,
): AgentEventHandler {
  return (sessionId, agent, event) => {
    const ctx: EmitContext = {
      room: roomFor(sessionId),
      sessionId,
      conversationId: agent.agentId,
      author: authorFor(agent),
    };
    relayStreamingEvent(io, ctx, event);
    relayTerminalEvent(io, store, ctx, event);
  };
}

/** Relays the streaming variants (placeholder + incremental tokens). */
function relayStreamingEvent(
  io: Server,
  ctx: EmitContext,
  event: AgentEvent,
): void {
  switch (event.type) {
    case "start":
      return emitStart(io, ctx, event.messageId);
    case "delta":
      return emitDelta(io, ctx, event);
    case "thinking":
      return emitThinking(io, ctx, event);
  }
}

/** Relays the terminal/run-level variants (finalize, error, activity). */
function relayTerminalEvent(
  io: Server,
  store: SessionStore,
  ctx: EmitContext,
  event: AgentEvent,
): void {
  switch (event.type) {
    case "end":
      return emitEnd(io, store, ctx, event);
    case "error":
      return emitError(io, ctx, event);
    case "activity":
      return emitActivity(io, ctx, event.activity);
    case "queue":
      return emitQueue(io, ctx, event);
  }
}

/** Builds the handler that broadcasts sub-agent roster changes to the room. */
export function createSubagentUpdateHandler(
  io: Server,
  store: SessionStore,
): SubagentUpdateHandler {
  return (sessionId, subagent) => {
    const payload: SubagentUpdatePayload = { sessionId, subagent };
    io.to(roomFor(sessionId)).emit(SocketEvents.SubagentUpdate, payload);

    // Persist so a restart's revive sees the current status (only `active` is
    // re-spawned); `error` stays distinct, completions and kills collapse.
    const status: SessionAgentStatus =
      subagent.status === "active" || subagent.status === "error"
        ? subagent.status
        : "killed";
    void store.setAgentStatus(sessionId, subagent.id, status);
  };
}

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
 * Builds the handler that surfaces a directed message into a sub-agent's
 * thread (e.g. a task Prime sends a sub-agent). The message is persisted and
 * broadcast as a normal `chat:message`, so it lands in the right transcript via
 * its `conversationId` and survives reconnects.
 */
export function createAgentMessageHandler(
  io: Server,
  store: SessionStore,
): AgentMessageHandler {
  return (sessionId, conversationId, author, content) => {
    const message = buildMessage(
      randomUUID(),
      sessionId,
      conversationId,
      author,
      content,
    );
    void store.appendMessage(message).then(() => {
      io.to(roomFor(sessionId)).emit(SocketEvents.ChatMessage, message);
    });
  };
}

/**
 * Handler that surfaces an applied memory write as a highlighted, persisted
 * chat message. Built from the actual stored text (not the agent's claim) so
 * the user always sees ground truth.
 */
export type MemoryRememberedHandler = (
  sessionId: string,
  scope: MemoryScope,
  text: string,
) => Promise<void>;

/** Builds the {@link MemoryRememberedHandler} bound to the room + store. */
export function createMemoryRememberedHandler(
  io: Server,
  store: SessionStore,
): MemoryRememberedHandler {
  return async (sessionId, scope, text) => {
    const message: ChatMessage = {
      ...buildMessage(
        randomUUID(),
        sessionId,
        PRIME_AGENT_ID,
        MEMORY_AUTHOR,
        text,
      ),
      memory: { scope },
    };
    await store.appendMessage(message);
    io.to(roomFor(sessionId)).emit(SocketEvents.ChatMessage, message);
  };
}

/** Emits a memory suggestion card into the session room. */
export type MemorySuggestionHandler = (
  payload: MemorySuggestionPayload,
) => void;

/** Builds the {@link MemorySuggestionHandler} bound to the room. */
export function createMemorySuggestionHandler(
  io: Server,
): MemorySuggestionHandler {
  return (payload) => {
    io.to(roomFor(payload.sessionId)).emit(
      SocketEvents.MemorySuggestion,
      payload,
    );
  };
}

/**
 * Applies a confirmed suggestion: writes it to the resolved store, surfaces the
 * highlight, and tells Prime the user approved so it can continue honestly.
 */
async function handleMemoryConfirm(
  store: SessionStore,
  pi: PiAgentManager,
  memory: MemoryManager,
  onRemembered: MemoryRememberedHandler,
  payload: MemoryConfirmPayload,
): Promise<void> {
  const suggestion = memory.takeSuggestion(payload?.suggestionId);
  if (!suggestion || suggestion.sessionId !== payload.sessionId) return;

  const session = await store.getSession(suggestion.sessionId);
  if (!session) return;

  const result = memory.write(
    session.rootPath,
    suggestion.scope,
    suggestion.text,
  );
  await onRemembered(suggestion.sessionId, result.scope, result.added);
  pi.sendToAgent(
    suggestion.sessionId,
    PRIME_AGENT_ID,
    `The user confirmed your suggestion. It has been stored to ${result.scope} ` +
      `memory: "${result.added}".`,
  );
}

/**
 * Applies a human-requested model/thinking change: respawns the target agent's
 * Pi process with the new settings, persists the selection so it survives a
 * restart, and surfaces it. Sub-agent changes ride the roster-update handler
 * (fired inside {@link PiAgentManager.setAgentModel}); Prime's change is
 * broadcast here via the dedicated `agent:model` event.
 */
function handleAgentSetModel(
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

/** Tells Prime a suggestion was declined; nothing is written. */
function handleMemoryDismiss(
  pi: PiAgentManager,
  memory: MemoryManager,
  payload: MemoryDismissPayload,
): void {
  const suggestion = memory.takeSuggestion(payload?.suggestionId);
  if (!suggestion || suggestion.sessionId !== payload.sessionId) return;
  pi.sendToAgent(
    suggestion.sessionId,
    PRIME_AGENT_ID,
    `The user declined to remember: "${suggestion.text}". Do not store it.`,
  );
}

/**
 * Registers chat (and a reserved terminal) handlers on the Socket.IO server.
 *
 * Phase 2 behaviour: clients join one room per session and receive history on
 * join. Each session is backed by a long-lived Pi agent process; posted
 * messages are broadcast to the room and relayed into the session's Pi
 * process, whose reply is streamed back via the agent:* events.
 */
export function registerChatHandlers(
  io: Server,
  store: SessionStore,
  pi: PiAgentManager,
  remoteGateway: RemoteEnvironmentGateway,
  memory: MemoryManager,
  onRemembered: MemoryRememberedHandler,
  triggerEngine: TriggerEngine,
  emitUiCommand: UiCommandEmitter,
): void {
  io.on("connection", (socket: Socket) => {
    socket.on(SocketEvents.ChatJoin, (payload: ChatJoinPayload) =>
      handleChatJoin(socket, store, pi, remoteGateway, triggerEngine, payload),
    );

    socket.on(SocketEvents.ChatMessage, (payload: ChatMessagePayload) =>
      handleChatMessage(io, socket, store, pi, payload),
    );

    socket.on(SocketEvents.AgentAbort, (payload: AgentAbortPayload) =>
      pi.abort(payload?.sessionId, payload?.conversationId),
    );

    socket.on(SocketEvents.AgentSetModel, (payload: AgentSetModelPayload) =>
      handleAgentSetModel(io, store, pi, payload),
    );

    socket.on(SocketEvents.MemoryConfirm, (payload: MemoryConfirmPayload) =>
      handleMemoryConfirm(store, pi, memory, onRemembered, payload),
    );

    socket.on(SocketEvents.MemoryDismiss, (payload: MemoryDismissPayload) =>
      handleMemoryDismiss(pi, memory, payload),
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
  });
}

/** Reads Prime's persisted model/thinking selection, parsing the stored depth. */
async function loadPrimeOverride(
  store: SessionStore,
  sessionId: string,
): Promise<{ model?: string; thinkingDepth?: ThinkingLevel } | undefined> {
  const agents = await store.listAgents(sessionId);
  const prime = agents.find((a) => a.id === PRIME_AGENT_ID);
  if (!prime) return undefined;
  return {
    model: prime.model,
    thinkingDepth: parseThinkingLevel(prime.thinkingDepth),
  };
}

/**
 * Replays each live agent's current run-level activity to the joining socket, so
 * a client reconnecting mid-run sees the in-progress tool call / "thinking"
 * indicator and bubble instead of them going blank until the next event.
 */
function replayAgentActivities(
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
function emitPrimeSelection(
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
async function handleSessionStatusSubscribe(
  socket: Socket,
  pi: PiAgentManager,
): Promise<void> {
  await socket.join(SESSIONS_LOBBY);
  const payload: SessionStatusSnapshotPayload = { statuses: pi.getStatuses() };
  socket.emit(SocketEvents.SessionStatusSnapshot, payload);
}

/**
 * (Re)spawns the session's Prime — restoring any persisted model/thinking
 * selection — and revives previously-active local sub-agents from the persisted
 * roster, so a restart restores the full agent set (not just Prime). Idempotent:
 * agents already live are skipped.
 */
async function ensureSessionAgents(
  store: SessionStore,
  pi: PiAgentManager,
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
  pi.reviveSubagents(session.id, persistedAgents);
}

/** Merges a session's local and remote sub-agent rosters for the UI. */
function mergedSubagents(
  pi: PiAgentManager,
  remoteGateway: RemoteEnvironmentGateway,
  sessionId: string,
) {
  return [
    ...pi.listSubagents(sessionId),
    ...remoteGateway.listSubagents(sessionId),
  ];
}

/** Joins the session room, then replays history and the sub-agent roster. */
async function handleChatJoin(
  socket: Socket,
  store: SessionStore,
  pi: PiAgentManager,
  remoteGateway: RemoteEnvironmentGateway,
  triggerEngine: TriggerEngine,
  payload: ChatJoinPayload,
): Promise<void> {
  const session = await store.getSession(payload?.sessionId);
  if (!session) {
    socket.emit("error", { message: "Session not found" });
    return;
  }

  const room = roomFor(session.id);
  await socket.join(room);

  // Lazily (re)spawn Prime and revive previously-active local sub-agents in
  // case the server restarted or the session predates the process manager.
  await ensureSessionAgents(store, pi, session);

  // Re-arm the session's schedule triggers (idempotent) and surface the roster.
  triggerEngine.sync(session.id, session.rootPath);

  const history = await store.getMessages(session.id);
  socket.emit(SocketEvents.ChatHistory, history);

  const roster: SubagentRosterPayload = {
    sessionId: session.id,
    subagents: mergedSubagents(pi, remoteGateway, session.id),
  };
  socket.emit(SocketEvents.SubagentRoster, roster);

  // Replay each live agent's current run-level activity for the joining client.
  replayAgentActivities(socket, pi, session.id);

  // Surface Prime's current model/thinking (the roster only tracks sub-agents).
  emitPrimeSelection(socket, pi, session.id);

  const triggerRoster: TriggerRosterPayload = {
    sessionId: session.id,
    triggers: triggerEngine.list(session.id),
  };
  socket.emit(SocketEvents.TriggerRoster, triggerRoster);

  await replayArtifacts(socket, store, session.id);
}

/**
 * Surfaces the session's current pinned-artifact list to just the joining
 * socket, using the same `artifacts.update` directive that broadcasts later
 * mutations.
 */
async function replayArtifacts(
  socket: Socket,
  store: SessionStore,
  sessionId: string,
): Promise<void> {
  const artifacts = await store.getArtifacts(sessionId);
  const payload: UiCommandPayload = {
    sessionId,
    command: { kind: "artifacts.update", artifacts },
  };
  socket.emit(SocketEvents.UiCommand, payload);
}

/** A validated artifact reference extracted from a pin/unpin payload. */
interface ArtifactRef {
  sessionId: string;
  path: string;
}

/** Validates a pin/unpin payload, returning a trimmed ref or null if invalid. */
function readArtifactRef(payload?: {
  sessionId?: string;
  path?: string;
}): ArtifactRef | null {
  if (!payload) return null;
  const path = payload.path?.trim();
  if (!payload.sessionId || !path) return null;
  return { sessionId: payload.sessionId, path };
}

/** Pins an artifact, then broadcasts the updated list to the session room. */
async function handleArtifactPin(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  payload: ArtifactPinPayload,
): Promise<void> {
  const ref = readArtifactRef(payload);
  if (!ref) return;
  const session = await store.getSession(ref.sessionId);
  if (!session) return;

  const artifacts = await store.pinArtifact(session.id, {
    path: ref.path,
    title: payload.title?.trim() || ref.path,
  });
  emitUiCommand(session.id, { kind: "artifacts.update", artifacts });
}

/** Unpins an artifact, then broadcasts the updated list to the session room. */
async function handleArtifactUnpin(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  payload: ArtifactUnpinPayload,
): Promise<void> {
  const ref = readArtifactRef(payload);
  if (!ref) return;
  const session = await store.getSession(ref.sessionId);
  if (!session) return;

  const artifacts = await store.unpinArtifact(session.id, ref.path);
  emitUiCommand(session.id, { kind: "artifacts.update", artifacts });
}

/** Persists + broadcasts a human message and relays it into the Pi process. */
async function handleChatMessage(
  io: Server,
  socket: Socket,
  store: SessionStore,
  pi: PiAgentManager,
  payload: ChatMessagePayload,
): Promise<void> {
  const session = await store.getSession(payload?.sessionId);
  if (!session) {
    socket.emit("error", { message: "Session not found" });
    return;
  }

  const room = roomFor(session.id);
  // Target agent thread: Prime by default, or a specific sub-agent so users can
  // steer it from its own tab.
  const conversationId = payload.conversationId ?? PRIME_AGENT_ID;
  const delivery = payload.delivery ?? "auto";

  // Broadcast the user's own message to the room (including the sender, so it
  // renders without optimistic updates and other participants see it). Tagged
  // with the target conversation so it lands in the right thread.
  const userMessage = buildMessage(
    randomUUID(),
    session.id,
    conversationId,
    payload.author,
    payload.content,
    undefined,
    payload.attachments,
  );
  await store.appendMessage(userMessage);
  io.to(room).emit(SocketEvents.ChatMessage, userMessage);

  // Relay the message into the session's Pi process, surfacing any attached
  // files by their workspace-relative path so the agent knows to read them. The
  // reply streams back asynchronously through the agent event handler.
  // `delivery` controls whether a mid-run message steers (before the next LLM
  // call) or queues as a follow-up. The message is already persisted/broadcast
  // above, so sub-agent sends omit `surfaceAuthor` to avoid a duplicate bubble.
  const text = promptWithAttachments(payload.content, payload.attachments);
  if (conversationId === PRIME_AGENT_ID) {
    pi.prompt(session.id, session.rootPath, text, delivery);
    return;
  }
  pi.sendToAgent(session.id, conversationId, text, undefined, delivery);
}
