import {
  type AgentAbortPayload,
  type AgentActivity,
  type AgentActivityPayload,
  type AgentDeltaPayload,
  type AgentEndPayload,
  type AgentErrorPayload,
  type AgentModelPayload,
  type AgentSetModelPayload,
  type AgentStartPayload,
  type AgentThinkingPayload,
  type ArtifactPinPayload,
  type ArtifactUnpinPayload,
  type Attachment,
  type ChatMessage,
  type ChatMessagePayload,
  type ConversationHistoryPayload,
  type ConversationSubscribePayload,
  humanAuthor,
  type MemoryConfirmPayload,
  type MemoryDismissPayload,
  type MemorySuggestionPayload,
  type MessageDelivery,
  PI_AGENT,
  type PinnedArtifact,
  type RunId,
  type Session,
  SocketEvents,
  type SubagentInfo,
  type SubagentRosterPayload,
  type SubagentStatus,
  type SubagentUpdatePayload,
  type ThinkingLevel,
  type Trigger,
  type TriggerRosterPayload,
  type TriggerUpdatePayload,
  type UiCommand,
  type UiCommandPayload,
} from "@tangent/shared/contracts";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import {
  type AgentLiveStatus,
  AgentStatusQueryKeys,
} from "@/features/chat/model/agentStatusQueryKeys";
import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";
import { useCurrentUser } from "@/features/user/hooks/useCurrentUser";
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

/** Messages bucketed by the `conversationId` they belong to. */
type MessageMap = Map<string, ChatMessage[]>;

/** Stable empty result so an unknown Conversation doesn't churn renders. */
const NO_MESSAGES: ChatMessage[] = [];

/** Within one Conversation, order by `seq`; `id` breaks a tie deterministically. */
function bySeq(a: ChatMessage, b: ChatMessage): number {
  return a.seq - b.seq || a.id.localeCompare(b.id);
}

/** Groups a flat history into per-Conversation buckets, each sorted by `seq`. */
function groupByConversation(history: ChatMessage[]): MessageMap {
  const map: MessageMap = new Map();
  for (const message of history) {
    const bucket = map.get(message.conversationId);
    if (bucket) bucket.push(message);
    else map.set(message.conversationId, [message]);
  }
  for (const bucket of map.values()) bucket.sort(bySeq);
  return map;
}

/** Merges one Conversation's history in, deduped by id (incoming wins). */
function mergeConversation(
  prev: MessageMap,
  conversationId: string,
  incoming: ChatMessage[],
): MessageMap {
  const byId = new Map<string, ChatMessage>();
  for (const message of prev.get(conversationId) ?? [])
    byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  const next = new Map(prev);
  next.set(conversationId, [...byId.values()].sort(bySeq));
  return next;
}

/**
 * Inserts a message into an already-`seq`-sorted bucket at its ordered slot.
 * A live append is usually the newest, so scan from the end — but two humans
 * typing while an agent streams can interleave, and the tiebreak keeps every
 * client rendering the same order regardless of arrival order.
 */
function insertBySeq(
  bucket: ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  let i = bucket.length;
  while (i > 0 && bySeq(bucket[i - 1], message) > 0) i--;
  const next = bucket.slice();
  next.splice(i, 0, message);
  return next;
}

/** Appends a message to its Conversation bucket in `seq` order. */
function appendToConversation(
  prev: MessageMap,
  message: ChatMessage,
): MessageMap {
  const next = new Map(prev);
  const bucket = next.get(message.conversationId) ?? NO_MESSAGES;
  next.set(message.conversationId, insertBySeq(bucket, message));
  return next;
}

/** Replaces one message by id in a Conversation bucket via an updater. */
function editInConversation(
  prev: MessageMap,
  conversationId: string,
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
): MessageMap {
  const bucket = prev.get(conversationId);
  if (!bucket) return prev;
  const next = new Map(prev);
  next.set(
    conversationId,
    bucket.map((m) => (m.id === messageId ? update(m) : m)),
  );
  return next;
}

/**
 * Manages a single Socket.IO connection for one session's chat room.
 *
 * The connection is created in an effect keyed on `sessionId` and torn down on
 * unmount or when the session changes, so the socket identity stays stable for
 * a given room.
 */
export function useSessionChat(sessionId: string) {
  // Messages bucketed per Conversation. The server delivers each Conversation's
  // Messages to a room the socket joins only if authorized, so a bucket exists
  // only for a Conversation this client may see — the client no longer filters
  // one shared stream.
  const [messagesByConversation, setMessagesByConversation] =
    useState<MessageMap>(() => new Map());
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  // The orchestrator's home Conversation — the primary ("Prime") thread the main
  // Chat tab renders. Server-derived from the `orchestrator` capability (roster
  // payload) so the client no longer privileges the reserved `"prime"` id.
  // Seeded with `PI_AGENT.id` for a legacy session whose Prime keeps that id.
  const [primaryConversationId, setPrimaryConversationId] = useState<string>(
    PI_AGENT.id,
  );
  // Maps an agent id to the Conversation its thread lives in (`SubagentInfo.id →
  // conversationId`, plus Prime → `primaryConversationId`). Components resolve an
  // agent tab/card to its Conversation through this rather than assuming equality.
  const [conversationByAgent, setConversationByAgent] = useState<
    Map<string, string>
  >(() => new Map());
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
  const [historyLoaded, setHistoryLoaded] = useState(false);
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
  const socketRef = useRef<Socket | null>(null);
  // Conversations this socket has already been subscribed to since the last
  // connect (seeded from the join-time roster). A sub-agent that spawns later
  // arrives as a `subagent:update` for an unseen id, which triggers a
  // `conversation:subscribe` so its room and history are joined on demand.
  const subscribedConversations = useRef<Set<string>>(new Set());
  // Reverse of `conversationByAgent` (conversationId → agent id), used only to
  // key the shared agent-status cache — which `useAgentStatus` reads by agent id
  // — from socket events that now carry a decoupled conversation id. A ref: no
  // render depends on it; it mirrors the roster as it arrives.
  const agentByConversation = useRef<Map<string, string>>(new Map());
  // Maps an in-flight message id to its conversation so `agent:delta` /
  // `agent:thinking` / `agent:error` (which only carry a messageId) can reach
  // the right thread's bucket and streaming state.
  const conversationByMessageId = useRef<Map<string, string>>(new Map());
  // The run each conversation is currently working under, so `abort` can name
  // the run it means. Refs, not state: nothing renders from either, and the
  // conversation-keyed state above already drives every visual.
  const runIdByConversation = useRef<Map<string, RunId>>(new Map());
  // Runs with a message mid-stream. `agent:activity` going null also happens
  // between messages within a run, so this is what distinguishes "the run's last
  // event" from "the spinner cleared because text started arriving".
  const streamingRuns = useRef<Set<RunId>>(new Set());

  // The current human's chat identity. Only used to recognise our own messages
  // in the transcript — the server authors what it persists, from the socket's
  // own cookie, so this shares `humanAuthor` with it rather than guessing.
  const user = useCurrentUser();
  const author = humanAuthor(user);

  useEffect(() => {
    if (!sessionId) return;

    // Connects to the same origin; Vite proxies /socket.io to the dev server.
    // The path is mount-prefix aware so it works behind the tangle pod-proxy
    // sub-path (`${BASE_PREFIX}socket.io`, i.e. `/socket.io` at the origin root).
    const socket = io({ autoConnect: true, path: `${BASE_PREFIX}socket.io` });
    socketRef.current = socket;

    // Status inputs mirrored alongside the React state, so each socket handler
    // can publish an agent's live status to the query cache the moment it
    // changes — in lockstep with the state that drives the chat (rather than via
    // a post-commit effect that a one-shot replay or cache eviction could miss).
    const streaming = new Set<string>();
    const activities = new Map<string, AgentActivity>();
    const statuses = new Map<string, SubagentStatus>();

    // Publishes one agent's derived live status. Prime has no lifecycle of its
    // own, so it always reads as `active`; busy spans message streaming and any
    // run-level activity, matching `isConversationBusy`.
    const publish = (agentId: string) => {
      const status: AgentLiveStatus = {
        status:
          agentId === PI_AGENT.id
            ? "active"
            : (statuses.get(agentId) ?? "active"),
        busy: streaming.has(agentId) || activities.has(agentId),
        activity: activities.get(agentId) ?? null,
      };
      queryClient.setQueryData(
        AgentStatusQueryKeys.Detail(sessionId, agentId),
        status,
      );
    };

    // Resolves the agent that owns a Conversation, so a socket event carrying a
    // decoupled conversation id keys the agent-status cache (read by agent id).
    // Falls back to the id itself for a legacy agent whose ids still coincide.
    const agentIdOf = (conversationId: string) =>
      agentByConversation.current.get(conversationId) ?? conversationId;

    // Republishes Prime plus every known sub-agent (e.g. after a (re)connect or
    // disconnect, when the busy/activity inputs reset for all of them at once).
    const publishAll = () => {
      publish(PI_AGENT.id);
      for (const id of statuses.keys()) publish(id);
    };

    // Follows a conversation's run through the activity indicator: a non-null
    // activity records which run is working, and a null one with nothing
    // streaming is the run's last event, so the conversation has no run again.
    const trackRunActivity = (
      conversationId: string,
      activity: AgentActivity | null,
      runId: RunId | undefined,
    ) => {
      if (activity) {
        if (runId) runIdByConversation.current.set(conversationId, runId);
        return;
      }
      const current = runId ?? runIdByConversation.current.get(conversationId);
      if (!current || streamingRuns.current.has(current)) return;
      runIdByConversation.current.delete(conversationId);
    };

    socket.on("connect", () => {
      // Reset on (re)connect rather than synchronously in the effect body so we
      // don't trigger cascading renders; history and roster repopulate via the
      // ChatHistory and SubagentRoster events the server sends on join.
      setMessagesByConversation(new Map());
      setHistoryLoaded(false);
      setSubagents([]);
      setPrimaryConversationId(PI_AGENT.id);
      setConversationByAgent(new Map());
      setModelByAgent(new Map());
      setTriggers([]);
      setArtifacts([]);
      setConnected(true);
      setStreamingConversations(new Set());
      setStreamingMessageIds(new Set());
      setActivityByConversation(new Map());
      setMemorySuggestions([]);
      conversationByMessageId.current.clear();
      runIdByConversation.current.clear();
      streamingRuns.current.clear();
      agentByConversation.current.clear();
      // Prime is joined server-side at chat:join; seed its id so a later update
      // for it doesn't re-subscribe. The roster replaces this with Prime's real
      // home conversation once it arrives.
      subscribedConversations.current = new Set([PI_AGENT.id]);
      // Reset the published statuses; the join snapshot (roster + replayed
      // activity) republishes them. Prime is present immediately.
      streaming.clear();
      activities.clear();
      statuses.clear();
      publish(PI_AGENT.id);
      socket.emit(SocketEvents.ChatJoin, { sessionId });
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setArtifacts([]);
      setStreamingConversations(new Set());
      setStreamingMessageIds(new Set());
      setActivityByConversation(new Map());
      setMemorySuggestions([]);
      conversationByMessageId.current.clear();
      runIdByConversation.current.clear();
      streamingRuns.current.clear();
      subscribedConversations.current.clear();
      // Nothing is running while disconnected; clear the busy inputs and
      // republish every known agent as idle (keeping their lifecycle status).
      streaming.clear();
      activities.clear();
      publishAll();
    });

    // Join-time seed of every authorized Conversation, grouped into buckets.
    socket.on(SocketEvents.ChatHistory, (history: ChatMessage[]) => {
      setMessagesByConversation(groupByConversation(history));
      setHistoryLoaded(true);
    });
    // A Conversation subscribed to after join (a newly spawned sub-agent):
    // merge its log into its bucket without disturbing the others.
    socket.on(
      SocketEvents.ConversationHistory,
      ({ conversationId, messages }: ConversationHistoryPayload) => {
        setMessagesByConversation((prev) =>
          mergeConversation(prev, conversationId, messages),
        );
      },
    );
    socket.on(SocketEvents.ChatMessage, (message: ChatMessage) => {
      setMessagesByConversation((prev) => appendToConversation(prev, message));
      // A message carrying an attachment or a memory write is catalogued
      // server-side; refetch the resource list so the catalog view reflects it.
      if (message.attachments?.length || message.memory) {
        void queryClient.invalidateQueries({
          queryKey: SessionQueryKeys.Resources(sessionId),
        });
      }
    });

    // An agent begins a (new) message: append an empty placeholder we fill via
    // deltas and mark that conversation's message stream in flight.
    socket.on(
      SocketEvents.AgentStart,
      ({ message, runId }: AgentStartPayload) => {
        conversationByMessageId.current.set(message.id, message.conversationId);
        if (runId) {
          runIdByConversation.current.set(message.conversationId, runId);
          streamingRuns.current.add(runId);
        }
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
        setMessagesByConversation((prev) =>
          appendToConversation(prev, message),
        );
        const agentId = agentIdOf(message.conversationId);
        streaming.add(agentId);
        publish(agentId);
      },
    );
    // Streamed token: append it to the matching in-flight message, routed to its
    // Conversation bucket via the id-to-conversation map set at `agent:start`.
    socket.on(
      SocketEvents.AgentDelta,
      ({ messageId, delta }: AgentDeltaPayload) => {
        const conversationId = conversationByMessageId.current.get(messageId);
        if (!conversationId) return;
        setMessagesByConversation((prev) =>
          editInConversation(prev, conversationId, messageId, (m) => ({
            ...m,
            content: m.content + delta,
          })),
        );
      },
    );
    // Streamed reasoning token: append it to the matching message's thinking.
    socket.on(
      SocketEvents.AgentThinking,
      ({ messageId, delta }: AgentThinkingPayload) => {
        const conversationId = conversationByMessageId.current.get(messageId);
        if (!conversationId) return;
        setMessagesByConversation((prev) =>
          editInConversation(prev, conversationId, messageId, (m) => ({
            ...m,
            thinking: (m.thinking ?? "") + delta,
          })),
        );
      },
    );
    // A single message finished: replace its placeholder with the final
    // message and end that message's stream. The run may still be busy (the
    // activity indicator drives that); message streaming is cleared here.
    socket.on(SocketEvents.AgentEnd, ({ message, runId }: AgentEndPayload) => {
      conversationByMessageId.current.delete(message.id);
      if (runId) streamingRuns.current.delete(runId);
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
      setMessagesByConversation((prev) =>
        editInConversation(
          prev,
          message.conversationId,
          message.id,
          () => message,
        ),
      );
      const agentId = agentIdOf(message.conversationId);
      streaming.delete(agentId);
      publish(agentId);
    });
    // The agent's run-level activity changed: a non-null activity surfaces the
    // ephemeral spinner bubble; null clears it (message streaming / run idle).
    socket.on(
      SocketEvents.AgentActivity,
      ({ conversationId, activity, runId }: AgentActivityPayload) => {
        trackRunActivity(conversationId, activity, runId);
        setActivityByConversation((prev) => {
          const next = new Map(prev);
          if (activity) {
            next.set(conversationId, activity);
          } else {
            next.delete(conversationId);
          }
          return next;
        });
        const agentId = agentIdOf(conversationId);
        if (activity) {
          activities.set(agentId, activity);
        } else {
          activities.delete(agentId);
        }
        publish(agentId);
      },
    );
    socket.on(
      SocketEvents.AgentError,
      ({ messageId, message, runId }: AgentErrorPayload) => {
        const conversationId = messageId
          ? conversationByMessageId.current.get(messageId)
          : undefined;
        if (messageId) conversationByMessageId.current.delete(messageId);
        if (runId) streamingRuns.current.delete(runId);
        if (conversationId) runIdByConversation.current.delete(conversationId);
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
          const agentId = agentIdOf(conversationId);
          streaming.delete(agentId);
          activities.delete(agentId);
          publish(agentId);
        }
        console.error("[chat] agent error:", message);
      },
    );

    // Full roster snapshot (sent on join): replace local state and seed each
    // sub-agent's model/thinking selection.
    socket.on(
      SocketEvents.SubagentRoster,
      ({
        subagents: roster,
        primaryConversationId: primary,
      }: SubagentRosterPayload) => {
        setSubagents(roster);
        setPrimaryConversationId(primary);
        setConversationByAgent(() => {
          const next = new Map<string, string>([[PI_AGENT.id, primary]]);
          for (const s of roster) next.set(s.id, s.conversationId);
          return next;
        });
        agentByConversation.current = new Map([[primary, PI_AGENT.id]]);
        for (const s of roster)
          agentByConversation.current.set(s.conversationId, s.id);
        // Prime's home is joined server-side at chat:join; record it so a later
        // roster/update for it does not re-subscribe.
        subscribedConversations.current.add(primary);
        setModelByAgent((prev) => {
          const next = new Map(prev);
          for (const s of roster) {
            next.set(s.id, { model: s.model, thinkingDepth: s.thinkingDepth });
          }
          return next;
        });
        for (const s of roster) {
          statuses.set(s.id, s.status);
          // Joined server-side at chat:join; record it so a later update for it
          // does not re-subscribe.
          subscribedConversations.current.add(s.conversationId);
          publish(s.id);
        }
      },
    );
    // A single sub-agent spawned or changed status: upsert by id.
    socket.on(
      SocketEvents.SubagentUpdate,
      ({ subagent }: SubagentUpdatePayload) => {
        // A sub-agent this client hasn't been subscribed to yet spawned after
        // join: subscribe so its per-Conversation room and history are joined.
        if (!subscribedConversations.current.has(subagent.conversationId)) {
          subscribedConversations.current.add(subagent.conversationId);
          const payload: ConversationSubscribePayload = {
            sessionId,
            conversationId: subagent.conversationId,
          };
          socket.emit(SocketEvents.ConversationSubscribe, payload);
        }
        setConversationByAgent((prev) =>
          new Map(prev).set(subagent.id, subagent.conversationId),
        );
        agentByConversation.current.set(subagent.conversationId, subagent.id);
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
        statuses.set(subagent.id, subagent.status);
        publish(subagent.id);
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

    // A Participant's presence changed (a human connected/left, a person was
    // revoked): refetch the roster so the presence dots stay live. The roster
    // is fetched over REST, so a targeted invalidation is enough.
    socket.on(SocketEvents.ParticipantPresence, () => {
      void queryClient.invalidateQueries({
        queryKey: SessionQueryKeys.Participants(sessionId),
      });
    });

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
        // A pin/unpin mirrors into the resource catalog; refetch its view.
        void queryClient.invalidateQueries({
          queryKey: SessionQueryKeys.Resources(sessionId),
        });
        return;
      }
      dispatchUiCommand(command);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      // Forget this session's published agent statuses so the cache doesn't
      // retain stale entries across a session change or unmount.
      queryClient.removeQueries({
        queryKey: AgentStatusQueryKeys.Session(sessionId),
      });
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
      content: trimmed,
      conversationId: options?.conversationId ?? primaryConversationId,
      delivery: options?.delivery ?? "auto",
      ...(hasAttachments ? { attachments } : {}),
    };
    socket.emit(SocketEvents.ChatMessage, payload);
  }

  // Cancels the run an agent (`"prime"` or a sub-agent id) is working under,
  // naming the run when we know it so a run that has since been replaced isn't
  // the one cancelled. The UI clears via the usual agent events.
  function abort(conversationId: string) {
    const socket = socketRef.current;
    if (!socket) return;
    const payload: AgentAbortPayload = {
      sessionId,
      conversationId,
      runId: runIdByConversation.current.get(conversationId),
    };
    socket.emit(SocketEvents.AgentAbort, payload);
  }

  // Changes an agent's model and/or thinking depth (`"prime"` or a sub-agent
  // id). The server respawns that agent's process and echoes the new selection
  // back via `agent:model` (Prime) or the roster update (sub-agents).
  function setAgentModel(agentId: string, selection: AgentModelSelection) {
    const socket = socketRef.current;
    if (!socket) return;
    const payload: AgentSetModelPayload = {
      sessionId,
      agentId,
      model: selection.model,
      thinkingDepth: selection.thinkingDepth,
    };
    socket.emit(SocketEvents.AgentSetModel, payload);
  }

  // The current model/thinking selection for an agent, or null when unknown
  // (the agent then runs the server default).
  function getAgentModel(agentId: string): AgentModelSelection | null {
    return modelByAgent.get(agentId) ?? null;
  }

  // Resolves a memory suggestion: tells the server to apply or discard it and
  // optimistically removes the card so it can't be answered twice.
  function resolveSuggestion(suggestionId: string, accept: boolean) {
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
  }

  function confirmMemory(suggestionId: string) {
    resolveSuggestion(suggestionId, true);
  }
  function dismissMemory(suggestionId: string) {
    resolveSuggestion(suggestionId, false);
  }

  // Pins an artifact (by workspace-relative path) for quick access. The server
  // dedupes by path and broadcasts the updated list back over `artifacts.update`.
  function pinArtifact(path: string, title: string) {
    const socket = socketRef.current;
    if (!socket) return;
    const payload: ArtifactPinPayload = { sessionId, path, title };
    socket.emit(SocketEvents.ArtifactPin, payload);
  }

  function unpinArtifact(path: string) {
    const socket = socketRef.current;
    if (!socket) return;
    const payload: ArtifactUnpinPayload = { sessionId, path };
    socket.emit(SocketEvents.ArtifactUnpin, payload);
  }

  // The set of pinned paths, for O(1) "is this artifact pinned?" checks when
  // rendering artifact chips.
  const pinnedPaths = new Set(artifacts.map((a) => a.path));

  // A conversation is busy while a message streams OR while it has a non-null
  // activity (thinking between turns / running a tool). Together these bracket
  // the whole run, even across multiple messages and tool calls.
  function isConversationBusy(conversationId: string) {
    return (
      streamingConversations.has(conversationId) ||
      activityByConversation.has(conversationId)
    );
  }

  // The current ephemeral activity for a conversation, or null when idle or a
  // message is actively streaming (the streaming bubble is the visual then).
  function getActivity(conversationId: string): AgentActivity | null {
    return activityByConversation.get(conversationId) ?? null;
  }

  function isMessageStreaming(messageId: string) {
    return streamingMessageIds.has(messageId);
  }

  // One Conversation's messages, in `seq` order, or an empty list when this
  // client holds no bucket for it (never subscribed / not authorized).
  function messagesFor(conversationId: string): ChatMessage[] {
    return messagesByConversation.get(conversationId) ?? NO_MESSAGES;
  }

  // The Conversation an agent's thread lives in, or the agent id itself when the
  // roster hasn't mapped it yet (a legacy agent whose ids coincide, or Prime
  // before the roster arrives). Components resolve an agent tab/card to its
  // thread through this rather than assuming `conversationId === agentId`.
  function conversationForAgent(agentId: string): string {
    return conversationByAgent.get(agentId) ?? agentId;
  }

  // Removes a sub-agent from the local roster (e.g. dismissing a killed agent
  // from the sidebar). The server still tracks it, so it reappears on the next
  // `subagent:roster` snapshot after a reconnect.
  function dismissSubagent(id: string) {
    setSubagents((prev) => prev.filter((s) => s.id !== id));
  }

  return {
    messagesFor,
    subagents,
    primaryConversationId,
    conversationForAgent,
    triggers,
    artifacts,
    pinnedPaths,
    pinArtifact,
    unpinArtifact,
    connected,
    historyLoaded,
    memorySuggestions,
    confirmMemory,
    dismissMemory,
    // The main thread's busy state drives the header/input; Prime owns it.
    agentBusy: isConversationBusy(primaryConversationId),
    isConversationBusy,
    getActivity,
    isMessageStreaming,
    currentAuthorId: author.id,
    send,
    abort,
    getAgentModel,
    setAgentModel,
    dismissSubagent,
  };
}
