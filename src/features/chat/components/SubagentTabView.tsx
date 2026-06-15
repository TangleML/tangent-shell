import type {
  AgentActivity,
  Attachment,
  MessageDelivery,
} from "@shared/contracts";
import { useMemo } from "react";

import type { ChatMessage } from "@/features/chat/model/types";
import { BlockStack } from "@/shared/ui/layout";

import { ChatInput } from "./ChatInput";
import { ChatMessageList } from "./ChatMessageList";

interface SubagentTabViewProps {
  sessionId: string;
  /** The sub-agent (and conversation) this tab is dedicated to. */
  agentId: string;
  /** Display name, used in the stop control's label. */
  name: string;
  /** All chat messages; filtered to this sub-agent's conversation. */
  messages: ChatMessage[];
  currentAuthorId: string;
  /** Bundle this session was created from; enables `tangent-ui:` components. */
  bundleId?: string;
  activity: AgentActivity | null;
  /** Whether this sub-agent's run is in flight. */
  busy: boolean;
  /** Disables the composer (e.g. while the socket is disconnected). */
  disabled?: boolean;
  isMessageStreaming: (messageId: string) => boolean;
  /** Aborts this sub-agent's in-progress run. */
  onAbort: () => void;
  /** Sends (or nudges) a message to this sub-agent's thread. */
  onSubmit: (
    content: string,
    options: { delivery: MessageDelivery; attachments?: Attachment[] },
  ) => void;
  /** Pending steer/follow-up nudges for this sub-agent. */
  queued?: { steering: string[]; followUp: string[] } | null;
  /** Opens a browser-viewable artifact referenced in a message. */
  onOpenArtifact: (url: string, title: string) => void;
  pinnedPaths: Set<string>;
  onTogglePinArtifact: (path: string, title: string) => void;
}

/**
 * A single sub-agent's thread, shown in its own in-app tab. Users can steer or
 * follow-up a sub-agent directly here (mirroring the Prime composer) while its
 * run is in flight, or message it when idle.
 */
export function SubagentTabView({
  sessionId,
  agentId,
  messages,
  currentAuthorId,
  bundleId,
  activity,
  busy,
  disabled,
  isMessageStreaming,
  onAbort,
  onSubmit,
  queued,
  onOpenArtifact,
  pinnedPaths,
  onTogglePinArtifact,
}: SubagentTabViewProps) {
  const visibleMessages = useMemo(
    () => messages.filter((m) => m.conversationId === agentId),
    [messages, agentId],
  );

  return (
    <BlockStack grow>
      <ChatMessageList
        sessionId={sessionId}
        messages={visibleMessages}
        currentAuthorId={currentAuthorId}
        activity={activity}
        bundleId={bundleId}
        onOpenArtifact={onOpenArtifact}
        pinnedPaths={pinnedPaths}
        onTogglePinArtifact={onTogglePinArtifact}
        isMessageStreaming={isMessageStreaming}
      />
      <ChatInput
        sessionId={sessionId}
        disabled={disabled}
        agentBusy={busy}
        onAbort={onAbort}
        onSubmit={onSubmit}
        queued={queued}
      />
    </BlockStack>
  );
}
