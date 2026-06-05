import { randomUUID } from "node:crypto";

import {
  type ChatAuthor,
  type ChatJoinPayload,
  type ChatMessage,
  type ChatMessagePayload,
  SocketEvents,
} from "@shared/contracts.ts";
import type { Server, Socket } from "socket.io";

import type { SessionStore } from "../store/sessionStore.ts";

function roomFor(sessionId: string): string {
  return `session:${sessionId}`;
}

// Stand-in for the Pi agent in Phase 1: a server-side participant that replies.
const ECHO_AGENT: ChatAuthor = {
  id: "echo-agent",
  kind: "agent",
  name: "Echo",
};

function buildMessage(
  sessionId: string,
  author: ChatAuthor,
  content: string,
): ChatMessage {
  return {
    id: randomUUID(),
    sessionId,
    author,
    content,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Registers chat (and a reserved terminal) handlers on the Socket.IO server.
 *
 * Phase 1 behaviour: clients join one room per session, receive history on
 * join, and any posted message is broadcast to the room followed by a reply
 * from the Echo agent. Pi workers will later replace the Echo agent and stream
 * terminal output.
 */
export function registerChatHandlers(io: Server, store: SessionStore): void {
  io.on("connection", (socket: Socket) => {
    socket.on(SocketEvents.ChatJoin, async (payload: ChatJoinPayload) => {
      const session = await store.getSession(payload?.sessionId);
      if (!session) {
        socket.emit("error", { message: "Session not found" });
        return;
      }

      const room = roomFor(session.id);
      await socket.join(room);

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
        session.id,
        payload.author,
        payload.content,
      );
      await store.appendMessage(userMessage);
      io.to(room).emit(SocketEvents.ChatMessage, userMessage);

      // Reply as the Echo agent so the server round-trip is visible and the
      // agent/markdown rendering path is exercised. This is the Phase 1
      // stand-in for a real Pi agent response.
      const agentReply = buildMessage(
        session.id,
        ECHO_AGENT,
        `**Echo:** ${payload.content}`,
      );
      await store.appendMessage(agentReply);
      io.to(room).emit(SocketEvents.ChatMessage, agentReply);
    });

    // Terminal streaming channel is reserved for Phase 2 Pi workers. Registered
    // here so the protocol is stable; it currently emits nothing.
    socket.on(SocketEvents.TerminalData, () => {
      // no-op stub
    });
  });
}
