import { randomUUID } from "node:crypto";

import {
  type AgentAbortPayload,
  type AgentActivity,
  type AgentActivityPayload,
  type AgentDeltaPayload,
  type AgentEndPayload,
  type AgentErrorPayload,
  type AgentStartPayload,
  type AgentThinkingPayload,
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
  SocketEvents,
  type SubagentRosterPayload,
  type SubagentUpdatePayload,
  type TriggerRosterPayload,
} from "@shared/contracts.ts";
import type { Server, Socket } from "socket.io";

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
import type { SessionStore } from "../store/sessionStore.ts";

function roomFor(sessionId: string): string {
  return `session:${sessionId}`;
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
  }
}

/** Builds the handler that broadcasts sub-agent roster changes to the room. */
export function createSubagentUpdateHandler(io: Server): SubagentUpdateHandler {
  return (sessionId, subagent) => {
    const payload: SubagentUpdatePayload = { sessionId, subagent };
    io.to(roomFor(sessionId)).emit(SocketEvents.SubagentUpdate, payload);
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
  memory: MemoryManager,
  onRemembered: MemoryRememberedHandler,
  triggerEngine: TriggerEngine,
): void {
  io.on("connection", (socket: Socket) => {
    socket.on(SocketEvents.ChatJoin, (payload: ChatJoinPayload) =>
      handleChatJoin(socket, store, pi, triggerEngine, payload),
    );

    socket.on(SocketEvents.ChatMessage, (payload: ChatMessagePayload) =>
      handleChatMessage(io, socket, store, pi, payload),
    );

    socket.on(SocketEvents.AgentAbort, (payload: AgentAbortPayload) =>
      pi.abort(payload?.sessionId, payload?.conversationId),
    );

    socket.on(SocketEvents.MemoryConfirm, (payload: MemoryConfirmPayload) =>
      handleMemoryConfirm(store, pi, memory, onRemembered, payload),
    );

    socket.on(SocketEvents.MemoryDismiss, (payload: MemoryDismissPayload) =>
      handleMemoryDismiss(pi, memory, payload),
    );

    // Terminal streaming channel is reserved for a later phase. Registered
    // here so the protocol is stable; it currently emits nothing.
    socket.on(SocketEvents.TerminalData, () => {
      // no-op stub
    });
  });
}

/** Joins the session room, then replays history and the sub-agent roster. */
async function handleChatJoin(
  socket: Socket,
  store: SessionStore,
  pi: PiAgentManager,
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

  // Lazily (re)spawn the agent in case the server restarted or the session was
  // created before the process manager existed.
  pi.ensure(session.id, session.rootPath);

  // Re-arm the session's schedule triggers (idempotent) and surface the roster.
  triggerEngine.sync(session.id, session.rootPath);

  const history = await store.getMessages(session.id);
  socket.emit(SocketEvents.ChatHistory, history);

  const roster: SubagentRosterPayload = {
    sessionId: session.id,
    subagents: pi.listSubagents(session.id),
  };
  socket.emit(SocketEvents.SubagentRoster, roster);

  const triggerRoster: TriggerRosterPayload = {
    sessionId: session.id,
    triggers: triggerEngine.list(session.id),
  };
  socket.emit(SocketEvents.TriggerRoster, triggerRoster);
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

  // Broadcast the user's own message to the room (including the sender, so it
  // renders without optimistic updates and other participants see it).
  const userMessage = buildMessage(
    randomUUID(),
    session.id,
    PRIME_AGENT_ID,
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
  pi.prompt(
    session.id,
    session.rootPath,
    promptWithAttachments(payload.content, payload.attachments),
  );
}
