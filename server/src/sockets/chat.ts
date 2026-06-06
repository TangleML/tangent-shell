import { randomUUID } from "node:crypto";

import {
  type AgentDeltaPayload,
  type AgentEndPayload,
  type AgentErrorPayload,
  type AgentStartPayload,
  type AgentThinkingPayload,
  type ChatAuthor,
  type ChatJoinPayload,
  type ChatMessage,
  type ChatMessagePayload,
  PI_AGENT,
  SocketEvents,
  type SubagentRosterPayload,
  type SubagentUpdatePayload,
} from "@shared/contracts.ts";
import type { Server, Socket } from "socket.io";

import {
  type AgentDescriptor,
  type AgentEventHandler,
  type AgentMessageHandler,
  type PiAgentManager,
  PRIME_AGENT_ID,
  type SubagentUpdateHandler,
} from "../pi/piAgentManager.ts";
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
): ChatMessage {
  return {
    id,
    sessionId,
    conversationId,
    author,
    content,
    ...(thinking ? { thinking } : {}),
    createdAt: new Date().toISOString(),
  };
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

/**
 * Builds the handler that relays agents' streaming events to the matching
 * session room. The final assistant message is persisted before the
 * `agent:end` event is broadcast so reconnecting clients see it in history.
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
    const room = roomFor(sessionId);
    const author = authorFor(agent);
    const conversationId = agent.agentId;

    switch (event.type) {
      case "start": {
        const message = buildMessage(
          event.messageId,
          sessionId,
          conversationId,
          author,
          "",
        );
        const payload: AgentStartPayload = { message };
        io.to(room).emit(SocketEvents.AgentStart, payload);
        return;
      }

      case "delta": {
        const payload: AgentDeltaPayload = {
          sessionId,
          messageId: event.messageId,
          delta: event.delta,
        };
        io.to(room).emit(SocketEvents.AgentDelta, payload);
        return;
      }

      case "thinking": {
        const payload: AgentThinkingPayload = {
          sessionId,
          messageId: event.messageId,
          delta: event.delta,
        };
        io.to(room).emit(SocketEvents.AgentThinking, payload);
        return;
      }

      case "end": {
        const message = buildMessage(
          event.messageId,
          sessionId,
          conversationId,
          author,
          event.content,
          event.thinking,
        );
        void store.appendMessage(message).then(() => {
          const payload: AgentEndPayload = { message };
          io.to(room).emit(SocketEvents.AgentEnd, payload);
        });
        return;
      }

      case "error": {
        const payload: AgentErrorPayload = {
          sessionId,
          messageId: event.messageId,
          message: event.message,
        };
        io.to(room).emit(SocketEvents.AgentError, payload);
        return;
      }
    }
  };
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
): void {
  io.on("connection", (socket: Socket) => {
    socket.on(SocketEvents.ChatJoin, async (payload: ChatJoinPayload) => {
      const session = await store.getSession(payload?.sessionId);
      if (!session) {
        socket.emit("error", { message: "Session not found" });
        return;
      }

      const room = roomFor(session.id);
      await socket.join(room);

      // Lazily (re)spawn the agent in case the server restarted or the
      // session was created before the process manager existed.
      pi.ensure(session.id, session.rootPath);

      const history = await store.getMessages(session.id);
      socket.emit(SocketEvents.ChatHistory, history);

      const roster: SubagentRosterPayload = {
        sessionId: session.id,
        subagents: pi.listSubagents(session.id),
      };
      socket.emit(SocketEvents.SubagentRoster, roster);
    });

    socket.on(SocketEvents.ChatMessage, async (payload: ChatMessagePayload) => {
      const session = await store.getSession(payload?.sessionId);
      if (!session) {
        socket.emit("error", { message: "Session not found" });
        return;
      }

      const room = roomFor(session.id);

      // Broadcast the user's own message to the room (including the sender, so
      // it renders without optimistic updates and other participants see it).
      const userMessage = buildMessage(
        randomUUID(),
        session.id,
        PRIME_AGENT_ID,
        payload.author,
        payload.content,
      );
      await store.appendMessage(userMessage);
      io.to(room).emit(SocketEvents.ChatMessage, userMessage);

      // Relay the message into the session's Pi process. The reply streams
      // back asynchronously through the agent event handler.
      pi.prompt(session.id, session.rootPath, payload.content);
    });

    // Terminal streaming channel is reserved for a later phase. Registered
    // here so the protocol is stable; it currently emits nothing.
    socket.on(SocketEvents.TerminalData, () => {
      // no-op stub
    });
  });
}
