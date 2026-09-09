import {
  type AgentActivity,
  type MemorySuggestionPayload,
  PI_AGENT,
  type PinnedArtifact,
  type Session,
  type SubagentInfo,
  type ThinkingLevel,
  type Trigger,
  type UiCommand,
} from "@tangent/shared/contracts";

import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";
import { queryClient } from "@/shared/api/queryClient";

import { type MessageMap } from "./sessionChatMessages";

/** An agent's current model/thinking selection (absent fields = server default). */
export interface AgentModelSelection {
  model?: string;
  thinkingDepth?: ThinkingLevel;
}

/** The immutable view a session's chat room publishes to its React subscribers. */
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

export function emptySessionChat(): SessionChatSnapshot {
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

/** Applies a server-pushed UI command to the client's cache. */
export function dispatchUiCommand(command: UiCommand): void {
  if (command.kind === "session.update") applySessionUpdate(command.session);
}

function applySessionUpdate(session: Session): void {
  queryClient.setQueryData(SessionQueryKeys.Id(session.id), session);
  queryClient.setQueryData<Session[]>(SessionQueryKeys.All(), (prev) =>
    prev?.map((s) => (s.id === session.id ? session : s)),
  );
}

export function addToSet<T>(prev: Set<T>, value: T): Set<T> {
  const next = new Set(prev);
  next.add(value);
  return next;
}

export function removeFromSet<T>(prev: Set<T>, value: T): Set<T> {
  if (!prev.has(value)) return prev;
  const next = new Set(prev);
  next.delete(value);
  return next;
}
