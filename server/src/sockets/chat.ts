import { randomUUID } from "node:crypto";

import {
  type AgentDeltaPayload,
  type AgentEndPayload,
  type AgentErrorPayload,
  type AgentStartPayload,
  type ChatAuthor,
  type ChatJoinPayload,
  type ChatMessage,
  type ChatMessagePayload,
  PI_AGENT,
  SocketEvents,
} from "@shared/contracts.ts";
import type { Server, Socket } from "socket.io";

import type { AgentEventHandler, PiAgentManager } from "../pi/piAgentManager.ts";
import type { SessionStore } from "../store/sessionStore.ts";

function roomFor(sessionId: string): string {
  return `session:${sessionId}`;
}

function buildMessage(
  id: string,
  sessionId: string,
  author: ChatAuthor,
  content: string,
): ChatMessage {
  return {
    id,
    sessionId,
    author,
    content,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Builds the handler that relays Pi's streaming events to the matching
 * session room. The final assistant message is persisted before the
 * `agent:end` event is broadcast so reconnecting clients see it in history.
 */
export function createAgentEventHandler(
  io: Server,
  store: SessionStore,
): AgentEventHandler {
  return (sessionId, event) => {
    const room = roomFor(sessionId);

    switch (event.type) {
      case "start": {
        const message = buildMessage(event.messageId, sessionId, PI_AGENT, "");
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

      case "end": {
        const message = buildMessage(
          event.messageId,
          sessionId,
          PI_AGENT,
          event.content,
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
