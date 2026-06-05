import {
  type AgentDeltaPayload,
  type AgentEndPayload,
  type AgentErrorPayload,
  type AgentStartPayload,
  type AgentThinkingPayload,
  type ChatAuthor,
  type ChatMessage,
  type ChatMessagePayload,
  SocketEvents,
} from "@shared/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * Manages a single Socket.IO connection for one session's chat room.
 *
 * The connection is created in an effect keyed on `sessionId` and torn down on
 * unmount or when the session changes, so the socket identity stays stable for
 * a given room.
 */
export function useSessionChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // One author identity per mounted chat (a stand-in for real auth in Phase 1).
  const author = useMemo<ChatAuthor>(
    () => ({ id: crypto.randomUUID(), kind: "human", name: "You" }),
    [],
  );

  useEffect(() => {
    if (!sessionId) return;

    // Connects to the same origin; Vite proxies /socket.io to the dev server.
    const socket = io({ autoConnect: true });
    socketRef.current = socket;

    socket.on("connect", () => {
      // Reset on (re)connect rather than synchronously in the effect body so we
      // don't trigger cascading renders; history will repopulate via ChatHistory.
      setMessages([]);
      setConnected(true);
      setAgentBusy(false);
      socket.emit(SocketEvents.ChatJoin, { sessionId });
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setAgentBusy(false);
    });

    socket.on(SocketEvents.ChatHistory, (history: ChatMessage[]) => {
      setMessages(history);
    });
    socket.on(SocketEvents.ChatMessage, (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
    });

    // Pi begins a reply: append an empty placeholder we fill in via deltas.
    socket.on(SocketEvents.AgentStart, ({ message }: AgentStartPayload) => {
      setAgentBusy(true);
      setMessages((prev) => [...prev, message]);
    });
    // Streamed token: append it to the matching in-flight message.
    socket.on(
      SocketEvents.AgentDelta,
      ({ messageId, delta }: AgentDeltaPayload) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, content: m.content + delta } : m,
          ),
        );
      },
    );
    // Streamed reasoning token: append it to the matching message's thinking.
    socket.on(
      SocketEvents.AgentThinking,
      ({ messageId, delta }: AgentThinkingPayload) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, thinking: (m.thinking ?? "") + delta }
              : m,
          ),
        );
      },
    );
    // Pi finished: replace the placeholder content with the final message.
    socket.on(SocketEvents.AgentEnd, ({ message }: AgentEndPayload) => {
      setAgentBusy(false);
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? message : m)),
      );
    });
    socket.on(SocketEvents.AgentError, ({ message }: AgentErrorPayload) => {
      setAgentBusy(false);
      console.error("[chat] agent error:", message);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionId]);

  function send(content: string) {
    const trimmed = content.trim();
    const socket = socketRef.current;
    if (!trimmed || !socket) return;

    const payload: ChatMessagePayload = { sessionId, author, content: trimmed };
    socket.emit(SocketEvents.ChatMessage, payload);
  }

  return { messages, connected, agentBusy, currentAuthorId: author.id, send };
}
