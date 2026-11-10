import {
  type AgentActivity,
  type Attachment,
  type ChatMessage,
  humanAuthor,
  type MessageDelivery,
  type PinnedArtifact,
} from "@tangent/shared/contracts";
import { normalizePinnableUrl, pinKey } from "@tangent/shared/pins";
import { useSyncExternalStore } from "react";

import { useCurrentUser } from "@/features/user/hooks/useCurrentUser";

import {
  NO_MESSAGES,
  peekSessionChat,
  peekSessionChatRoom,
  subscribeToSessionChat,
} from "./sessionChatRoom";
import {
  type AgentModelSelection,
  EMPTY_SESSION_CHAT,
  type SessionChatSnapshot,
} from "./sessionChatSnapshot";

export type { AgentModelSelection };

const NOOP_SUBSCRIBE = () => () => {};

function isConversationBusy(
  snapshot: SessionChatSnapshot,
  conversationId: string,
): boolean {
  return (
    snapshot.streamingConversations.has(conversationId) ||
    snapshot.activityByConversation.has(conversationId)
  );
}

/**
 * Shared session-room state for one chat: messages, roster, artifacts, and
 * triggers. Multiple callers (SPA chat, embed chat, agent/asset lists) share
 * one Socket.IO connection via {@link subscribeToSessionChat}.
 */
export function useSessionChat(sessionId: string) {
  const user = useCurrentUser();
  const author = humanAuthor(user);

  const snapshot = useSyncExternalStore(
    sessionId ? subscribeToSessionChat(sessionId) : NOOP_SUBSCRIBE,
    () => (sessionId ? peekSessionChat(sessionId) : EMPTY_SESSION_CHAT),
    () => EMPTY_SESSION_CHAT,
  );
  const pinnedPaths = new Set(snapshot.artifacts.map(pinKey));

  // Pin keys are artifact paths or link URLs (see `pinKey`), so one toggle and
  // one unpin serve both chips/links in chat and the sidebar list. Unpin goes by
  // the stored pin's kind: a legacy artifact pin may have a URL as its path.
  function unpin(key: string): PinnedArtifact["kind"] | undefined {
    const pin = snapshot.artifacts.find((a) => pinKey(a) === key);
    if (!pin) return undefined;
    const room = peekSessionChatRoom(sessionId);
    if (pin.kind === "link") room?.unpinLink(pin.url);
    else room?.unpinArtifact(pin.path);
    return pin.kind;
  }

  function togglePin(key: string, title: string): void {
    if (pinnedPaths.has(key)) {
      unpin(key);
      return;
    }
    const room = peekSessionChatRoom(sessionId);
    const url = normalizePinnableUrl(key);
    if (url) room?.pinLink(url, title);
    else room?.pinArtifact(key, title);
  }

  function messagesFor(conversationId: string): ChatMessage[] {
    return snapshot.messagesByConversation.get(conversationId) ?? NO_MESSAGES;
  }

  function conversationForAgent(agentId: string): string {
    return snapshot.conversationByAgent.get(agentId) ?? agentId;
  }

  function getAgentModel(agentId: string): AgentModelSelection | null {
    return snapshot.modelByAgent.get(agentId) ?? null;
  }

  function getActivity(conversationId: string): AgentActivity | null {
    return snapshot.activityByConversation.get(conversationId) ?? null;
  }

  function isMessageStreaming(messageId: string): boolean {
    return snapshot.streamingMessageIds.has(messageId);
  }

  return {
    messagesFor,
    subagents: snapshot.subagents,
    primaryConversationId: snapshot.primaryConversationId,
    conversationForAgent,
    triggers: snapshot.triggers,
    artifacts: snapshot.artifacts,
    pinnedPaths,
    togglePin,
    unpin,
    connected: snapshot.connected,
    historyLoaded: snapshot.historyLoaded,
    rosterReady: snapshot.rosterReady,
    memorySuggestions: snapshot.memorySuggestions,
    confirmMemory: (suggestionId: string) =>
      peekSessionChatRoom(sessionId)?.confirmMemory(suggestionId),
    dismissMemory: (suggestionId: string) =>
      peekSessionChatRoom(sessionId)?.dismissMemory(suggestionId),
    agentBusy: isConversationBusy(snapshot, snapshot.primaryConversationId),
    isConversationBusy: (conversationId: string) =>
      isConversationBusy(snapshot, conversationId),
    getActivity,
    isMessageStreaming,
    currentAuthorId: author.id,
    send: (
      content: string,
      options?: {
        conversationId?: string;
        delivery?: MessageDelivery;
        attachments?: Attachment[];
      },
    ) => peekSessionChatRoom(sessionId)?.send(content, options),
    abort: (conversationId: string) =>
      peekSessionChatRoom(sessionId)?.abort(conversationId),
    getAgentModel,
    setAgentModel: (agentId: string, selection: AgentModelSelection) =>
      peekSessionChatRoom(sessionId)?.setAgentModel(agentId, selection),
    dismissSubagent: (id: string) =>
      peekSessionChatRoom(sessionId)?.dismissSubagent(id),
  };
}
