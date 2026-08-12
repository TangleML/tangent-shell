import {
  type AgentActivity,
  type AgentActivityPayload,
  type AgentDeltaPayload,
  type AgentEndPayload,
  type AgentErrorPayload,
  type AgentQueuePayload,
  type AgentStartPayload,
  type AgentThinkingPayload,
  type ChatAuthor,
  PI_AGENT,
  type RunId,
  type SessionStatusPayload,
  SocketEvents,
  sourceFromAuthor,
  type SubagentUpdatePayload,
} from "@tangent/shared/contracts.ts";
import type { Server } from "socket.io";

import type { ConversationRouter } from "../conversation/conversationRouter.ts";
import type {
  AgentDescriptor,
  AgentEvent,
  AgentEventHandler,
  AgentMessageHandler,
  SessionStatusHandler,
  SubagentUpdateHandler,
} from "../pi/types.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { roomFor, SESSIONS_LOBBY } from "./rooms.ts";

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
  /** The Run that produced the event, when the connector attributed one. */
  runId?: RunId;
}

/**
 * The `seq` reserved for each streaming message, held from `start` until the
 * turn finalizes so the placeholder and the Message that replaces it share one
 * ordinal.
 *
 * It doubles as the ordering gate. Reserving is asynchronous, and the client
 * drops a delta for a message id it has not seen, so every subsequent event for
 * that message chains off this promise: callbacks on one promise run in
 * registration order, which makes `start` before `delta` structural rather than
 * a matter of timing.
 */
const reservedSeqs = new Map<string, Promise<number>>();

/** The reservation to emit behind, or an immediate one when there was no start. */
function seqGate(messageId: string | undefined): Promise<number> {
  const reserved = messageId ? reservedSeqs.get(messageId) : undefined;
  return reserved ?? Promise.resolve(0);
}

function emitStart(
  io: Server,
  store: SessionStore,
  ctx: EmitContext,
  messageId: string,
): void {
  const reservation = store.nextSeq(ctx.sessionId, ctx.conversationId);
  reservedSeqs.set(messageId, reservation);
  void reservation.then((seq) => {
    const payload: AgentStartPayload = {
      message: {
        id: messageId,
        sessionId: ctx.sessionId,
        conversationId: ctx.conversationId,
        seq,
        author: ctx.author,
        mentions: [],
        source: sourceFromAuthor(ctx.author),
        content: "",
        runId: ctx.runId,
        createdAt: new Date().toISOString(),
      },
      runId: ctx.runId,
    };
    io.to(ctx.room).emit(SocketEvents.AgentStart, payload);
  });
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
    runId: ctx.runId,
  };
  void seqGate(event.messageId).then(() => {
    io.to(ctx.room).emit(SocketEvents.AgentDelta, payload);
  });
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
    runId: ctx.runId,
  };
  void seqGate(event.messageId).then(() => {
    io.to(ctx.room).emit(SocketEvents.AgentThinking, payload);
  });
}

/**
 * Posts a finalized turn as a Message in the producing agent's Conversation, and
 * broadcasts it as `agent:end` so the client replaces its streaming placeholder
 * instead of appending a second bubble. Posting is what wakes whoever reacts to
 * it, which is why nothing here decides who hears about it.
 *
 * Empty output and a cancelled turn are persisted but provoke nothing: neither is
 * a request, and a half-finished reply should not read as a finished one.
 */
function emitEnd(
  io: Server,
  conversations: ConversationRouter,
  ctx: EmitContext,
  event: {
    messageId: string;
    content: string;
    thinking: string;
    aborted?: boolean;
  },
): void {
  // Take the seq this turn reserved at `start`; a finalized message that never
  // streamed (no reservation) allocates one now.
  const reserved = reservedSeqs.get(event.messageId);
  reservedSeqs.delete(event.messageId);

  void (async () => {
    const seq = reserved ? await reserved : undefined;
    await conversations.post({
      id: event.messageId,
      sessionId: ctx.sessionId,
      conversationId: ctx.conversationId,
      seq,
      author: ctx.author,
      content: event.content,
      thinking: event.thinking,
      runId: ctx.runId,
      ...(ctx.runId ? { endsRun: true } : {}),
      provokes: Boolean(event.content.trim()) && !event.aborted,
      broadcast: (message) => {
        const payload: AgentEndPayload = { message, runId: ctx.runId };
        io.to(ctx.room).emit(SocketEvents.AgentEnd, payload);
      },
    });
  })();
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
    runId: ctx.runId,
  };
  // A failed turn spends its reserved seq without persisting anything, leaving a
  // gap. Emitted behind the reservation so the error still lands after `start`.
  const gate = seqGate(event.messageId);
  if (event.messageId) reservedSeqs.delete(event.messageId);
  void gate.then(() => {
    io.to(ctx.room).emit(SocketEvents.AgentError, payload);
  });
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
    runId: ctx.runId,
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
    runId: ctx.runId,
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
  conversations: ConversationRouter,
): AgentEventHandler {
  return (sessionId, agent, event) => {
    const ctx: EmitContext = {
      room: roomFor(sessionId),
      sessionId,
      conversationId: agent.agentId,
      author: authorFor(agent),
      runId: event.runId,
    };
    relayStreamingEvent(io, store, ctx, event);
    relayTerminalEvent(io, conversations, ctx, event);
  };
}

/** Relays the streaming variants (placeholder + incremental tokens). */
function relayStreamingEvent(
  io: Server,
  store: SessionStore,
  ctx: EmitContext,
  event: AgentEvent,
): void {
  switch (event.type) {
    case "start":
      return emitStart(io, store, ctx, event.messageId);
    case "delta":
      return emitDelta(io, ctx, event);
    case "thinking":
      return emitThinking(io, ctx, event);
  }
}

/** Relays the terminal/run-level variants (finalize, error, activity). */
function relayTerminalEvent(
  io: Server,
  conversations: ConversationRouter,
  ctx: EmitContext,
  event: AgentEvent,
): void {
  switch (event.type) {
    case "end":
      return emitEnd(io, conversations, ctx, event);
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

    // Persisted as-is: a participant's lifecycle is transcript-visible history,
    // so nothing is collapsed on the way to the row.
    void store.setAgentStatus(sessionId, subagent.id, subagent.status);
  };
}

/**
 * Builds the handler a transport uses to post a Message into a Conversation —
 * a report it received, or a refusal it has to explain. It is the router's `post`
 * with the transport's own dependencies left out.
 */
export function createAgentMessageHandler(
  conversations: ConversationRouter,
): AgentMessageHandler {
  return (posted) => {
    void conversations.post(posted);
  };
}

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
