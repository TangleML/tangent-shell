import type {
  AgentActivity,
  Attachment,
  MessageDelivery,
  ThinkingLevel,
} from "@tangent/shared/contracts";

import type { ChatMessage } from "@/features/chat/model/types";
import { Box } from "@/shared/ui/box";
import { BlockStack, InlineStack } from "@/shared/ui/layout";

import {
  AgentModelPicker,
  type AgentModelPickerValue,
} from "./AgentModelPicker";
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
  /** This sub-agent's current model id (absent = server default). */
  model?: string;
  /** This sub-agent's current thinking depth (absent = server default). */
  thinkingDepth?: ThinkingLevel;
  /** Changes this sub-agent's model and/or thinking depth. */
  onSetModel: (selection: AgentModelPickerValue) => void;
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
  model,
  thinkingDepth,
  onSetModel,
  onOpenArtifact,
  pinnedPaths,
  onTogglePinArtifact,
}: SubagentTabViewProps) {
  const visibleMessages = messages.filter((m) => m.conversationId === agentId);

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
      <Box paddingInline="base" paddingBlock="sm">
        <InlineStack align="end">
          <AgentModelPicker
            model={model}
            thinkingDepth={thinkingDepth}
            onChange={onSetModel}
            disabled={disabled}
          />
        </InlineStack>
      </Box>
      <ChatInput
        key={`${sessionId}:${agentId}`}
        sessionId={sessionId}
        agentId={agentId}
        disabled={disabled}
        agentBusy={busy}
        onAbort={onAbort}
        onSubmit={onSubmit}
      />
    </BlockStack>
  );
}
