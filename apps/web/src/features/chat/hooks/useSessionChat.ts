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
  type ChatMessage,
  type ChatMessagePayload,
  type MemoryConfirmPayload,
  type MemoryDismissPayload,
  type MemorySuggestionPayload,
  type MessageDelivery,
  PI_AGENT,
  type PinnedArtifact,
  type Session,
  SocketEvents,
  type SubagentInfo,
  type SubagentRosterPayload,
  type SubagentUpdatePayload,
  type ThinkingLevel,
  type Trigger,
  type TriggerRosterPayload,
  type TriggerUpdatePayload,
  type UiCommand,
  type UiCommandPayload,
} from "@tangent/shared/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";
import { queryClient } from "@/shared/api/queryClient";
import { BASE_PREFIX } from "@/shared/lib/basePath";

/**
 * Applies an agent-issued UI directive. New `UiCommand` variants add a `case`
 * here; unrecognized kinds are ignored so older clients stay forward-compatible.
 */
function dispatchUiCommand(command: UiCommand): void {
  switch (command.kind) {
    case "session.update":
      return applySessionUpdate(command.session);
  }
}

/**
 * Reflects a renamed (or otherwise updated) session in the query cache
 * immediately: the individual-session entry drives the chat header, and the
 * list entry keeps the sessions table current on its next visit. Writing the
 * cache directly avoids the list's `staleTime` delaying the header update.
 */
function applySessionUpdate(session: Session): void {
  queryClient.setQueryData(SessionQueryKeys.Id(session.id), session);
  queryClient.setQueryData<Session[]>(SessionQueryKeys.All(), (prev) =>
    prev?.map((s) => (s.id === session.id ? session : s)),
  );
}

/** An agent's current model/thinking selection (absent fields = server default). */
export interface AgentModelSelection {
  model?: string;
  thinkingDepth?: ThinkingLevel;
}

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
  // Per-agent model/thinking selection, keyed by agent id (`"prime"` or a
  // sub-agent id). Seeded from the roster (sub-agents) and the `agent:model`
  // event (Prime), and updated as either changes.
  const [modelByAgent, setModelByAgent] = useState<
    Map<string, AgentModelSelection>
  >(() => new Map());
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  // Artifacts the user (or an agent) pinned for quick access, kept in sync with
  // the room via the `artifacts.update` UI directive.
  const [artifacts, setArtifacts] = useState<PinnedArtifact[]>([]);
  const [connected, setConnected] = useState(false);
  // Pending agent-initiated memory suggestions awaiting the user's confirmation.
  const [memorySuggestions, setMemorySuggestions] = useState<
    MemorySuggestionPayload[]
  >([]);
  // Conversations (keyed by `conversationId`) with a message actively
  // streaming, i.e. between `agent:start` and `agent:end` for that message.
  const [streamingConversations, setStreamingConversations] = useState<
    Set<string>
  >(() => new Set());
  // In-flight message ids (between `agent:start` and `agent:end` / `agent:error`).
  const [streamingMessageIds, setStreamingMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  // The current ephemeral activity per conversation (tool call / "thinking"
  // between messages). Cleared when a message streams in or the run ends.
  const [activityByConversation, setActivityByConversation] = useState<
    Map<string, AgentActivity>
  >(() => new Map());
  // Pending steer/follow-up nudges per conversation, mirrored from the agent's
  // `agent:queue` events so the composer can surface what's waiting.
  const [queuedByConversation, setQueuedByConversation] = useState<
    Map<string, { steering: string[]; followUp: string[] }>
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
    // The path is mount-prefix aware so it works behind the oasis pod-proxy
    // sub-path (`${BASE_PREFIX}socket.io`, i.e. `/socket.io` at the origin root).
    const socket = io({ autoConnect: true, path: `${BASE_PREFIX}socket.io` });
    socketRef.current = socket;

    socket.on("connect", () => {
      // Reset on (re)connect rather than synchronously in the effect body so we
      // don't trigger cascading renders; history and roster repopulate via the
      // ChatHistory and SubagentRoster events the server sends on join.
      setMessages([]);
      setSubagents([]);
      setModelByAgent(new Map());
      setTriggers([]);
      setArtifacts([]);
      setConnected(true);
      setStreamingConversations(new Set());
      setStreamingMessageIds(new Set());
      setActivityByConversation(new Map());
      setQueuedByConversation(new Map());
      setMemorySuggestions([]);
      conversationByMessageId.current.clear();
      socket.emit(SocketEvents.ChatJoin, { sessionId });
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setArtifacts([]);
      setStreamingConversations(new Set());
      setStreamingMessageIds(new Set());
      setActivityByConversation(new Map());
      setQueuedByConversation(new Map());
      setMemorySuggestions([]);
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
      setStreamingMessageIds((prev) => {
        const next = new Set(prev);
        next.add(message.id);
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
      setStreamingMessageIds((prev) => {
        if (!prev.has(message.id)) return prev;
        const next = new Set(prev);
        next.delete(message.id);
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
    // The agent's pending steer/follow-up queue changed: mirror it so the
    // composer can show what's waiting. Empty arrays clear the entry.
    socket.on(
      SocketEvents.AgentQueue,
      ({ conversationId, steering, followUp }: AgentQueuePayload) => {
        setQueuedByConversation((prev) => {
          const next = new Map(prev);
          if (steering.length === 0 && followUp.length === 0) {
            next.delete(conversationId);
          } else {
            next.set(conversationId, { steering, followUp });
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
        if (messageId) {
          setStreamingMessageIds((prev) => {
            if (!prev.has(messageId)) return prev;
            const next = new Set(prev);
            next.delete(messageId);
            return next;
          });
        }
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

    // Full roster snapshot (sent on join): replace local state and seed each
    // sub-agent's model/thinking selection.
    socket.on(
      SocketEvents.SubagentRoster,
      ({ subagents: roster }: SubagentRosterPayload) => {
        setSubagents(roster);
        setModelByAgent((prev) => {
          const next = new Map(prev);
          for (const s of roster) {
            next.set(s.id, { model: s.model, thinkingDepth: s.thinkingDepth });
          }
          return next;
        });
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
        setModelByAgent((prev) =>
          new Map(prev).set(subagent.id, {
            model: subagent.model,
            thinkingDepth: subagent.thinkingDepth,
          }),
        );
      },
    );
    // Prime's model/thinking (sent on join and after a change): upsert by id.
    socket.on(
      SocketEvents.AgentModel,
      ({ agentId, model, thinkingDepth }: AgentModelPayload) => {
        setModelByAgent((prev) =>
          new Map(prev).set(agentId, { model, thinkingDepth }),
        );
      },
    );

    // The agent proposed remembering something: queue a confirm/dismiss card.
    socket.on(
      SocketEvents.MemorySuggestion,
      (suggestion: MemorySuggestionPayload) => {
        setMemorySuggestions((prev) => [...prev, suggestion]);
      },
    );

    // Full trigger roster (sent on join and after any change): replace state.
    socket.on(
      SocketEvents.TriggerRoster,
      ({ triggers: roster }: TriggerRosterPayload) => {
        setTriggers(roster);
      },
    );
    // A single trigger fired or changed: upsert by id.
    socket.on(
      SocketEvents.TriggerUpdate,
      ({ trigger }: TriggerUpdatePayload) => {
        setTriggers((prev) => {
          const next = prev.filter((t) => t.id !== trigger.id);
          next.push(trigger);
          return next;
        });
      },
    );

    // A generic agent->UI directive (e.g. a session rename): dispatch by kind.
    // `artifacts.update` carries the pinned-artifact list, which lives in this
    // hook's state (and drives the sidebar), so it's applied here directly;
    // everything else goes through the shared, cache-writing dispatcher.
    socket.on(SocketEvents.UiCommand, ({ command }: UiCommandPayload) => {
      if (command.kind === "artifacts.update") {
        setArtifacts(command.artifacts);
        return;
      }
      dispatchUiCommand(command);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionId]);

  // Sends a message to an agent thread. `conversationId` targets Prime by
  // default or a sub-agent; `delivery` controls how a mid-run message is queued
  // (steer before the next LLM call, or follow-up after the run stops).
  function send(
    content: string,
    options?: {
      conversationId?: string;
      delivery?: MessageDelivery;
      attachments?: Attachment[];
    },
  ) {
    const trimmed = content.trim();
    const socket = socketRef.current;
    const attachments = options?.attachments;
    const hasAttachments = Boolean(attachments && attachments.length);
    if ((!trimmed && !hasAttachments) || !socket) return;

    const payload: ChatMessagePayload = {
      sessionId,
      author,
      content: trimmed,
      conversationId: options?.conversationId ?? PI_AGENT.id,
      delivery: options?.delivery ?? "auto",
      ...(hasAttachments ? { attachments } : {}),
    };
    socket.emit(SocketEvents.ChatMessage, payload);
  }

  // Aborts an agent's in-progress run by id (`"prime"` or a sub-agent id). The
  // server resets the run's state and the UI clears via the usual agent events.
  const abort = useCallback(
    (conversationId: string) => {
      const socket = socketRef.current;
      if (!socket) return;
      const payload: AgentAbortPayload = { sessionId, conversationId };
      socket.emit(SocketEvents.AgentAbort, payload);
    },
    [sessionId],
  );

  // Changes an agent's model and/or thinking depth (`"prime"` or a sub-agent
  // id). The server respawns that agent's process and echoes the new selection
  // back via `agent:model` (Prime) or the roster update (sub-agents).
  const setAgentModel = useCallback(
    (agentId: string, selection: AgentModelSelection) => {
      const socket = socketRef.current;
      if (!socket) return;
      const payload: AgentSetModelPayload = {
        sessionId,
        agentId,
        model: selection.model,
        thinkingDepth: selection.thinkingDepth,
      };
      socket.emit(SocketEvents.AgentSetModel, payload);
    },
    [sessionId],
  );

  // The current model/thinking selection for an agent, or null when unknown
  // (the agent then runs the server default).
  const getAgentModel = useCallback(
    (agentId: string): AgentModelSelection | null =>
      modelByAgent.get(agentId) ?? null,
    [modelByAgent],
  );

  // Resolves a memory suggestion: tells the server to apply or discard it and
  // optimistically removes the card so it can't be answered twice.
  const resolveSuggestion = useCallback(
    (suggestionId: string, accept: boolean) => {
      const socket = socketRef.current;
      if (!socket) return;
      const event = accept
        ? SocketEvents.MemoryConfirm
        : SocketEvents.MemoryDismiss;
      const payload: MemoryConfirmPayload | MemoryDismissPayload = {
        sessionId,
        suggestionId,
      };
      socket.emit(event, payload);
      setMemorySuggestions((prev) =>
        prev.filter((s) => s.suggestionId !== suggestionId),
      );
    },
    [sessionId],
  );

  const confirmMemory = useCallback(
    (suggestionId: string) => resolveSuggestion(suggestionId, true),
    [resolveSuggestion],
  );
  const dismissMemory = useCallback(
    (suggestionId: string) => resolveSuggestion(suggestionId, false),
    [resolveSuggestion],
  );

  // Pins an artifact (by workspace-relative path) for quick access. The server
  // dedupes by path and broadcasts the updated list back over `artifacts.update`.
  const pinArtifact = useCallback(
    (path: string, title: string) => {
      const socket = socketRef.current;
      if (!socket) return;
      const payload: ArtifactPinPayload = { sessionId, path, title };
      socket.emit(SocketEvents.ArtifactPin, payload);
    },
    [sessionId],
  );

  const unpinArtifact = useCallback(
    (path: string) => {
      const socket = socketRef.current;
      if (!socket) return;
      const payload: ArtifactUnpinPayload = { sessionId, path };
      socket.emit(SocketEvents.ArtifactUnpin, payload);
    },
    [sessionId],
  );

  // The set of pinned paths, for O(1) "is this artifact pinned?" checks when
  // rendering artifact chips.
  const pinnedPaths = useMemo(
    () => new Set(artifacts.map((a) => a.path)),
    [artifacts],
  );

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

  const isMessageStreaming = useCallback(
    (messageId: string) => streamingMessageIds.has(messageId),
    [streamingMessageIds],
  );

  // Pending steer/follow-up nudges for a conversation, or null when none are
  // queued. Drives the composer's "queued nudge" indicator.
  const getQueued = useCallback(
    (
      conversationId: string,
    ): { steering: string[]; followUp: string[] } | null =>
      queuedByConversation.get(conversationId) ?? null,
    [queuedByConversation],
  );

  return {
    messages,
    subagents,
    triggers,
    artifacts,
    pinnedPaths,
    pinArtifact,
    unpinArtifact,
    connected,
    memorySuggestions,
    confirmMemory,
    dismissMemory,
    // The main thread's busy state drives the header/input; Prime owns it.
    agentBusy: isConversationBusy(PI_AGENT.id),
    isConversationBusy,
    getActivity,
    getQueued,
    isMessageStreaming,
    currentAuthorId: author.id,
    send,
    abort,
    getAgentModel,
    setAgentModel,
  };
}
