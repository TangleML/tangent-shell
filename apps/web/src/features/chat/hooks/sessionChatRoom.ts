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
import { type Socket } from "socket.io-client";

import {
  type AgentLiveStatus,
  AgentStatusQueryKeys,
} from "@/features/chat/model/agentStatusQueryKeys";
import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";
import { queryClient } from "@/shared/api/queryClient";
import { createSocket } from "@/shared/lib/socket";

import {
  appendToConversation,
  editInConversation,
  groupByConversation,
  mergeConversation,
  type MessageMap,
  NO_MESSAGES,
} from "./sessionChatMessages";

/** An agent's current model/thinking selection (absent fields = server default). */
export interface AgentModelSelection {
  model?: string;
  thinkingDepth?: ThinkingLevel;
}

export interface SessionChatSnapshot {
  messagesByConversation: MessageMap;
  subagents: SubagentInfo[];
  primaryConversationId: string;
  conversationByAgent: Map<string, string>;
  modelByAgent: Map<string, AgentModelSelection>;
  triggers: Trigger[];
  artifacts: PinnedArtifact[];
  connected: boolean;
  historyLoaded: boolean;
  rosterReady: boolean;
  memorySuggestions: MemorySuggestionPayload[];
  streamingConversations: Set<string>;
  streamingMessageIds: Set<string>;
  activityByConversation: Map<string, AgentActivity>;
}

function emptySessionChat(): SessionChatSnapshot {
  return {
    messagesByConversation: new Map(),
    subagents: [],
    primaryConversationId: PI_AGENT.id,
    conversationByAgent: new Map(),
    modelByAgent: new Map(),
    triggers: [],
    artifacts: [],
    connected: false,
    historyLoaded: false,
    rosterReady: false,
    memorySuggestions: [],
    streamingConversations: new Set(),
    streamingMessageIds: new Set(),
    activityByConversation: new Map(),
  };
}

export const EMPTY_SESSION_CHAT: SessionChatSnapshot = emptySessionChat();

function dispatchUiCommand(command: UiCommand): void {
  if (command.kind === "session.update") applySessionUpdate(command.session);
}

function applySessionUpdate(session: Session): void {
  queryClient.setQueryData(SessionQueryKeys.Id(session.id), session);
  queryClient.setQueryData<Session[]>(SessionQueryKeys.All(), (prev) =>
    prev?.map((s) => (s.id === session.id ? session : s)),
  );
}

function addToSet<T>(prev: Set<T>, value: T): Set<T> {
  const next = new Set(prev);
  next.add(value);
  return next;
}

function removeFromSet<T>(prev: Set<T>, value: T): Set<T> {
  if (!prev.has(value)) return prev;
  const next = new Set(prev);
  next.delete(value);
  return next;
}

/**
 * One Socket.IO connection for a session's chat room, shared across React
 * trees (SPA chat, embed chat, agent/asset lists) via refcounted acquire/release.
 */
class SessionChatRoom {
  snapshot: SessionChatSnapshot;
  private readonly listeners = new Set<() => void>();
  private socket: Socket | null = null;
  refCount = 0;

  private subscribedConversations = new Set<string>();
  private agentByConversation = new Map<string, string>();
  private conversationByMessageId = new Map<string, string>();
  private runIdByConversation = new Map<string, RunId>();
  private streamingRuns = new Set<RunId>();
  private streaming = new Set<string>();
  private activities = new Map<string, AgentActivity>();
  private statuses = new Map<string, SubagentStatus>();

  readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.snapshot = emptySessionChat();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  connect(): void {
    if (this.socket) return;
    const socket = createSocket();
    this.socket = socket;
    this.wire(socket);
  }

  disconnect(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    queryClient.removeQueries({
      queryKey: AgentStatusQueryKeys.Session(this.sessionId),
    });
  }

  send(
    content: string,
    options?: {
      conversationId?: string;
      delivery?: MessageDelivery;
      attachments?: Attachment[];
    },
  ): void {
    const trimmed = content.trim();
    const socket = this.socket;
    const attachments = options?.attachments;
    const hasAttachments = Boolean(attachments && attachments.length);
    if ((!trimmed && !hasAttachments) || !socket) return;

    const payload: ChatMessagePayload = {
      sessionId: this.sessionId,
      content: trimmed,
      conversationId:
        options?.conversationId ?? this.snapshot.primaryConversationId,
      delivery: options?.delivery ?? "auto",
      ...(hasAttachments ? { attachments } : {}),
    };
    socket.emit(SocketEvents.ChatMessage, payload);
  }

  abort(conversationId: string): void {
    const socket = this.socket;
    if (!socket) return;
    const payload: AgentAbortPayload = {
      sessionId: this.sessionId,
      conversationId,
      runId: this.runIdByConversation.get(conversationId),
    };
    socket.emit(SocketEvents.AgentAbort, payload);
  }

  setAgentModel(agentId: string, selection: AgentModelSelection): void {
    const socket = this.socket;
    if (!socket) return;
    const payload: AgentSetModelPayload = {
      sessionId: this.sessionId,
      agentId,
      model: selection.model,
      thinkingDepth: selection.thinkingDepth,
    };
    socket.emit(SocketEvents.AgentSetModel, payload);
  }

  confirmMemory(suggestionId: string): void {
    this.resolveSuggestion(suggestionId, true);
  }

  dismissMemory(suggestionId: string): void {
    this.resolveSuggestion(suggestionId, false);
  }

  pinArtifact(path: string, title: string): void {
    const socket = this.socket;
    if (!socket) return;
    const payload: ArtifactPinPayload = {
      sessionId: this.sessionId,
      path,
      title,
    };
    socket.emit(SocketEvents.ArtifactPin, payload);
  }

  unpinArtifact(path: string): void {
    const socket = this.socket;
    if (!socket) return;
    const payload: ArtifactUnpinPayload = { sessionId: this.sessionId, path };
    socket.emit(SocketEvents.ArtifactUnpin, payload);
  }

  dismissSubagent(id: string): void {
    this.patch((prev) => ({
      ...prev,
      subagents: prev.subagents.filter((s) => s.id !== id),
    }));
  }

  private resolveSuggestion(suggestionId: string, accept: boolean): void {
    const socket = this.socket;
    if (!socket) return;
    const event = accept
      ? SocketEvents.MemoryConfirm
      : SocketEvents.MemoryDismiss;
    const payload: MemoryConfirmPayload | MemoryDismissPayload = {
      sessionId: this.sessionId,
      suggestionId,
    };
    socket.emit(event, payload);
    this.patch((prev) => ({
      ...prev,
      memorySuggestions: prev.memorySuggestions.filter(
        (s) => s.suggestionId !== suggestionId,
      ),
    }));
  }

  private patch(
    update:
      | Partial<SessionChatSnapshot>
      | ((prev: SessionChatSnapshot) => SessionChatSnapshot),
  ): void {
    this.snapshot =
      typeof update === "function"
        ? update(this.snapshot)
        : { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }

  private publish(agentId: string): void {
    const status: AgentLiveStatus = {
      status:
        agentId === PI_AGENT.id
          ? "active"
          : (this.statuses.get(agentId) ?? "active"),
      busy: this.streaming.has(agentId) || this.activities.has(agentId),
      activity: this.activities.get(agentId) ?? null,
    };
    queryClient.setQueryData(
      AgentStatusQueryKeys.Detail(this.sessionId, agentId),
      status,
    );
  }

  private publishAll(): void {
    this.publish(PI_AGENT.id);
    for (const id of this.statuses.keys()) this.publish(id);
  }

  private agentIdOf(conversationId: string): string {
    return this.agentByConversation.get(conversationId) ?? conversationId;
  }

  private trackRunActivity(
    conversationId: string,
    activity: AgentActivity | null,
    runId: RunId | undefined,
  ): void {
    if (activity) {
      if (runId) this.runIdByConversation.set(conversationId, runId);
      return;
    }
    const current = runId ?? this.runIdByConversation.get(conversationId);
    if (!current || this.streamingRuns.has(current)) return;
    this.runIdByConversation.delete(conversationId);
  }

  private resetLiveMaps(): void {
    this.conversationByMessageId.clear();
    this.runIdByConversation.clear();
    this.streamingRuns.clear();
    this.streaming.clear();
    this.activities.clear();
  }

  private wire(socket: Socket): void {
    const { sessionId } = this;

    socket.on("connect", () => {
      this.agentByConversation.clear();
      this.subscribedConversations = new Set([PI_AGENT.id]);
      this.resetLiveMaps();
      this.statuses.clear();
      this.publish(PI_AGENT.id);
      this.patch({
        ...emptySessionChat(),
        connected: true,
      });
      socket.emit(SocketEvents.ChatJoin, { sessionId });
    });

    socket.on("disconnect", () => {
      this.resetLiveMaps();
      this.subscribedConversations.clear();
      this.publishAll();
      this.patch({
        connected: false,
        artifacts: [],
        streamingConversations: new Set(),
        streamingMessageIds: new Set(),
        activityByConversation: new Map(),
        memorySuggestions: [],
      });
    });

    socket.on(SocketEvents.ChatHistory, (history: ChatMessage[]) => {
      this.patch({
        messagesByConversation: groupByConversation(history),
        historyLoaded: true,
      });
    });

    socket.on(
      SocketEvents.ConversationHistory,
      ({ conversationId, messages }: ConversationHistoryPayload) => {
        this.patch((prev) => ({
          ...prev,
          messagesByConversation: mergeConversation(
            prev.messagesByConversation,
            conversationId,
            messages,
          ),
        }));
      },
    );

    socket.on(SocketEvents.ChatMessage, (message: ChatMessage) => {
      this.patch((prev) => ({
        ...prev,
        messagesByConversation: appendToConversation(
          prev.messagesByConversation,
          message,
        ),
      }));
      if (message.attachments?.length || message.memory) {
        void queryClient.invalidateQueries({
          queryKey: SessionQueryKeys.Resources(sessionId),
        });
      }
    });

    socket.on(
      SocketEvents.AgentStart,
      ({ message, runId }: AgentStartPayload) => {
        this.conversationByMessageId.set(message.id, message.conversationId);
        if (runId) {
          this.runIdByConversation.set(message.conversationId, runId);
          this.streamingRuns.add(runId);
        }
        this.patch((prev) => ({
          ...prev,
          streamingConversations: addToSet(
            prev.streamingConversations,
            message.conversationId,
          ),
          streamingMessageIds: addToSet(prev.streamingMessageIds, message.id),
          messagesByConversation: appendToConversation(
            prev.messagesByConversation,
            message,
          ),
        }));
        const agentId = this.agentIdOf(message.conversationId);
        this.streaming.add(agentId);
        this.publish(agentId);
      },
    );

    socket.on(
      SocketEvents.AgentDelta,
      ({ messageId, delta }: AgentDeltaPayload) => {
        const conversationId = this.conversationByMessageId.get(messageId);
        if (!conversationId) return;
        this.patch((prev) => ({
          ...prev,
          messagesByConversation: editInConversation(
            prev.messagesByConversation,
            conversationId,
            messageId,
            (m) => ({ ...m, content: m.content + delta }),
          ),
        }));
      },
    );

    socket.on(
      SocketEvents.AgentThinking,
      ({ messageId, delta }: AgentThinkingPayload) => {
        const conversationId = this.conversationByMessageId.get(messageId);
        if (!conversationId) return;
        this.patch((prev) => ({
          ...prev,
          messagesByConversation: editInConversation(
            prev.messagesByConversation,
            conversationId,
            messageId,
            (m) => ({ ...m, thinking: (m.thinking ?? "") + delta }),
          ),
        }));
      },
    );

    socket.on(SocketEvents.AgentEnd, ({ message, runId }: AgentEndPayload) => {
      this.conversationByMessageId.delete(message.id);
      if (runId) this.streamingRuns.delete(runId);
      this.patch((prev) => ({
        ...prev,
        streamingConversations: removeFromSet(
          prev.streamingConversations,
          message.conversationId,
        ),
        streamingMessageIds: removeFromSet(
          prev.streamingMessageIds,
          message.id,
        ),
        messagesByConversation: editInConversation(
          prev.messagesByConversation,
          message.conversationId,
          message.id,
          () => message,
        ),
      }));
      const agentId = this.agentIdOf(message.conversationId);
      this.streaming.delete(agentId);
      this.publish(agentId);
    });

    socket.on(
      SocketEvents.AgentActivity,
      ({ conversationId, activity, runId }: AgentActivityPayload) => {
        this.trackRunActivity(conversationId, activity, runId);
        this.patch((prev) => {
          const next = new Map(prev.activityByConversation);
          if (activity) next.set(conversationId, activity);
          else next.delete(conversationId);
          return { ...prev, activityByConversation: next };
        });
        const agentId = this.agentIdOf(conversationId);
        if (activity) this.activities.set(agentId, activity);
        else this.activities.delete(agentId);
        this.publish(agentId);
      },
    );

    socket.on(
      SocketEvents.AgentError,
      ({ messageId, message, runId }: AgentErrorPayload) => {
        const conversationId = messageId
          ? this.conversationByMessageId.get(messageId)
          : undefined;
        if (messageId) this.conversationByMessageId.delete(messageId);
        if (runId) this.streamingRuns.delete(runId);
        if (conversationId) this.runIdByConversation.delete(conversationId);
        this.patch((prev) => ({
          ...prev,
          streamingMessageIds: messageId
            ? removeFromSet(prev.streamingMessageIds, messageId)
            : prev.streamingMessageIds,
          streamingConversations: conversationId
            ? removeFromSet(prev.streamingConversations, conversationId)
            : prev.streamingConversations,
        }));
        if (conversationId) {
          const agentId = this.agentIdOf(conversationId);
          this.streaming.delete(agentId);
          this.activities.delete(agentId);
          this.publish(agentId);
        }
        console.error("[chat] agent error:", message);
      },
    );

    socket.on(
      SocketEvents.SubagentRoster,
      ({
        subagents: roster,
        primaryConversationId: primary,
      }: SubagentRosterPayload) => {
        this.agentByConversation = new Map([[primary, PI_AGENT.id]]);
        for (const s of roster)
          this.agentByConversation.set(s.conversationId, s.id);
        this.subscribedConversations.add(primary);
        for (const s of roster) {
          this.statuses.set(s.id, s.status);
          this.subscribedConversations.add(s.conversationId);
          this.publish(s.id);
        }
        this.patch((prev) => {
          const conversationByAgent = new Map<string, string>([
            [PI_AGENT.id, primary],
          ]);
          const modelByAgent = new Map(prev.modelByAgent);
          for (const s of roster) {
            conversationByAgent.set(s.id, s.conversationId);
            modelByAgent.set(s.id, {
              model: s.model,
              thinkingDepth: s.thinkingDepth,
            });
          }
          return {
            ...prev,
            subagents: roster,
            primaryConversationId: primary,
            rosterReady: true,
            conversationByAgent,
            modelByAgent,
          };
        });
      },
    );

    socket.on(
      SocketEvents.SubagentUpdate,
      ({ subagent }: SubagentUpdatePayload) => {
        if (!this.subscribedConversations.has(subagent.conversationId)) {
          this.subscribedConversations.add(subagent.conversationId);
          const payload: ConversationSubscribePayload = {
            sessionId,
            conversationId: subagent.conversationId,
          };
          socket.emit(SocketEvents.ConversationSubscribe, payload);
        }
        this.agentByConversation.set(subagent.conversationId, subagent.id);
        this.statuses.set(subagent.id, subagent.status);
        this.publish(subagent.id);
        this.patch((prev) => {
          const conversationByAgent = new Map(prev.conversationByAgent).set(
            subagent.id,
            subagent.conversationId,
          );
          const modelByAgent = new Map(prev.modelByAgent).set(subagent.id, {
            model: subagent.model,
            thinkingDepth: subagent.thinkingDepth,
          });
          const next = prev.subagents.filter((s) => s.id !== subagent.id);
          next.push(subagent);
          return {
            ...prev,
            conversationByAgent,
            modelByAgent,
            subagents: next,
          };
        });
      },
    );

    socket.on(
      SocketEvents.AgentModel,
      ({ agentId, model, thinkingDepth }: AgentModelPayload) => {
        this.patch((prev) => ({
          ...prev,
          modelByAgent: new Map(prev.modelByAgent).set(agentId, {
            model,
            thinkingDepth,
          }),
        }));
      },
    );

    socket.on(SocketEvents.ParticipantPresence, () => {
      void queryClient.invalidateQueries({
        queryKey: SessionQueryKeys.Participants(sessionId),
      });
    });

    socket.on(SocketEvents.ResourcesUpdated, () => {
      void queryClient.invalidateQueries({
        queryKey: SessionQueryKeys.Resources(sessionId),
      });
    });

    socket.on(
      SocketEvents.MemorySuggestion,
      (suggestion: MemorySuggestionPayload) => {
        this.patch((prev) => ({
          ...prev,
          memorySuggestions: [...prev.memorySuggestions, suggestion],
        }));
      },
    );

    socket.on(
      SocketEvents.TriggerRoster,
      ({ triggers: roster }: TriggerRosterPayload) => {
        this.patch({ triggers: roster });
      },
    );

    socket.on(
      SocketEvents.TriggerUpdate,
      ({ trigger }: TriggerUpdatePayload) => {
        this.patch((prev) => {
          const next = prev.triggers.filter((t) => t.id !== trigger.id);
          next.push(trigger);
          return { ...prev, triggers: next };
        });
      },
    );

    socket.on(SocketEvents.UiCommand, ({ command }: UiCommandPayload) => {
      if (command.kind !== "artifacts.update") {
        dispatchUiCommand(command);
        return;
      }
      this.patch({ artifacts: command.artifacts });
      void queryClient.invalidateQueries({
        queryKey: SessionQueryKeys.Resources(sessionId),
      });
    });
  }
}

const rooms = new Map<string, SessionChatRoom>();
const subscribeFns = new Map<
  string,
  (onStoreChange: () => void) => () => void
>();

function getOrCreateRoom(sessionId: string): SessionChatRoom {
  const existing = rooms.get(sessionId);
  if (existing) return existing;
  const room = new SessionChatRoom(sessionId);
  rooms.set(sessionId, room);
  return room;
}

/** Acquire a shared room; the first subscriber opens the socket. */
export function acquireSessionChatRoom(sessionId: string): SessionChatRoom {
  const room = getOrCreateRoom(sessionId);
  room.refCount += 1;
  if (room.refCount === 1) room.connect();
  return room;
}

/** Release a shared room; the last subscriber closes the socket. */
export function releaseSessionChatRoom(sessionId: string): void {
  const room = rooms.get(sessionId);
  if (!room) return;
  room.refCount -= 1;
  if (room.refCount > 0) return;
  room.disconnect();
  rooms.delete(sessionId);
  subscribeFns.delete(sessionId);
}

/**
 * Stable `useSyncExternalStore` subscribe for a session. Identity is cached
 * per `sessionId` so a re-render does not flap acquire/release (which would
 * tear down the socket).
 */
export function subscribeToSessionChat(
  sessionId: string,
): (onStoreChange: () => void) => () => void {
  const cached = subscribeFns.get(sessionId);
  if (cached) return cached;
  const subscribe = (onStoreChange: () => void) => {
    const room = acquireSessionChatRoom(sessionId);
    const unsub = room.subscribe(onStoreChange);
    return () => {
      unsub();
      releaseSessionChatRoom(sessionId);
    };
  };
  subscribeFns.set(sessionId, subscribe);
  return subscribe;
}

export function peekSessionChat(sessionId: string): SessionChatSnapshot {
  return rooms.get(sessionId)?.snapshot ?? EMPTY_SESSION_CHAT;
}

export function peekSessionChatRoom(sessionId: string): SessionChatRoom | null {
  return rooms.get(sessionId) ?? null;
}

export { NO_MESSAGES };
