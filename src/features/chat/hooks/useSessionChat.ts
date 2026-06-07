import {
  type AgentActivity,
  type AgentActivityPayload,
  type AgentDeltaPayload,
  type AgentEndPayload,
  type AgentErrorPayload,
  type AgentStartPayload,
  type AgentThinkingPayload,
  type ChatAuthor,
  type ChatMessage,
  type ChatMessagePayload,
  PI_AGENT,
  SocketEvents,
  type SubagentInfo,
  type SubagentRosterPayload,
  type SubagentUpdatePayload,
} from "@shared/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  const [connected, setConnected] = useState(false);
  // Conversations (keyed by `conversationId`) with a message actively
  // streaming, i.e. between `agent:start` and `agent:end` for that message.
  const [streamingConversations, setStreamingConversations] = useState<
    Set<string>
  >(() => new Set());
  // The current ephemeral activity per conversation (tool call / "thinking"
  // between messages). Cleared when a message streams in or the run ends.
  const [activityByConversation, setActivityByConversation] = useState<
    Map<string, AgentActivity>
  >(() => new Map());
  const socketRef = useRef<Socket | null>(null);
  // Maps an in-flight message id to its conversation so `agent:error` (which
  // only carries a messageId) can clear the right thread's streaming state.
  const conversationByMessageId = useRef<Map<string, string>>(new Map());

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
      // don't trigger cascading renders; history and roster repopulate via the
      // ChatHistory and SubagentRoster events the server sends on join.
      setMessages([]);
      setSubagents([]);
      setConnected(true);
      setStreamingConversations(new Set());
      setActivityByConversation(new Map());
      conversationByMessageId.current.clear();
      socket.emit(SocketEvents.ChatJoin, { sessionId });
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setStreamingConversations(new Set());
      setActivityByConversation(new Map());
      conversationByMessageId.current.clear();
    });

    socket.on(SocketEvents.ChatHistory, (history: ChatMessage[]) => {
      setMessages(history);
    });
    socket.on(SocketEvents.ChatMessage, (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
    });

    // An agent begins a (new) message: append an empty placeholder we fill via
    // deltas and mark that conversation's message stream in flight.
    socket.on(SocketEvents.AgentStart, ({ message }: AgentStartPayload) => {
      conversationByMessageId.current.set(message.id, message.conversationId);
      setStreamingConversations((prev) => {
        const next = new Set(prev);
        next.add(message.conversationId);
        return next;
      });
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
    // A single message finished: replace its placeholder with the final
    // message and end that message's stream. The run may still be busy (the
    // activity indicator drives that); message streaming is cleared here.
    socket.on(SocketEvents.AgentEnd, ({ message }: AgentEndPayload) => {
      conversationByMessageId.current.delete(message.id);
      setStreamingConversations((prev) => {
        if (!prev.has(message.conversationId)) return prev;
        const next = new Set(prev);
        next.delete(message.conversationId);
        return next;
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? message : m)),
      );
    });
    // The agent's run-level activity changed: a non-null activity surfaces the
    // ephemeral spinner bubble; null clears it (message streaming / run idle).
    socket.on(
      SocketEvents.AgentActivity,
      ({ conversationId, activity }: AgentActivityPayload) => {
        setActivityByConversation((prev) => {
          const next = new Map(prev);
          if (activity) {
            next.set(conversationId, activity);
          } else {
            next.delete(conversationId);
          }
          return next;
        });
      },
    );
    socket.on(
      SocketEvents.AgentError,
      ({ messageId, message }: AgentErrorPayload) => {
        const conversationId = messageId
          ? conversationByMessageId.current.get(messageId)
          : undefined;
        if (messageId) conversationByMessageId.current.delete(messageId);
        if (conversationId) {
          setStreamingConversations((prev) => {
            if (!prev.has(conversationId)) return prev;
            const next = new Set(prev);
            next.delete(conversationId);
            return next;
          });
        }
        console.error("[chat] agent error:", message);
      },
    );

    // Full roster snapshot (sent on join): replace local state.
    socket.on(
      SocketEvents.SubagentRoster,
      ({ subagents: roster }: SubagentRosterPayload) => {
        setSubagents(roster);
      },
    );
    // A single sub-agent spawned or changed status: upsert by id.
    socket.on(
      SocketEvents.SubagentUpdate,
      ({ subagent }: SubagentUpdatePayload) => {
        setSubagents((prev) => {
          const next = prev.filter((s) => s.id !== subagent.id);
          next.push(subagent);
          return next;
        });
      },
    );

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

  // A conversation is busy while a message streams OR while it has a non-null
  // activity (thinking between turns / running a tool). Together these bracket
  // the whole run, even across multiple messages and tool calls.
  const isConversationBusy = useCallback(
    (conversationId: string) =>
      streamingConversations.has(conversationId) ||
      activityByConversation.has(conversationId),
    [streamingConversations, activityByConversation],
  );

  // The current ephemeral activity for a conversation, or null when idle or a
  // message is actively streaming (the streaming bubble is the visual then).
  const getActivity = useCallback(
    (conversationId: string): AgentActivity | null =>
      activityByConversation.get(conversationId) ?? null,
    [activityByConversation],
  );

  return {
    messages,
    subagents,
    connected,
    // The main thread's busy state drives the header/input; Prime owns it.
    agentBusy: isConversationBusy(PI_AGENT.id),
    isConversationBusy,
    getActivity,
    currentAuthorId: author.id,
    send,
  };
}
