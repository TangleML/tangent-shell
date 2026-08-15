import type {
  AgentActivity,
  Attachment,
  MessageDelivery,
  SubagentStatus,
  ThinkingLevel,
} from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";

import type { MentionCandidate } from "@/features/chat/model/mentions";
import type { ChatMessage } from "@/features/chat/model/types";

import {
  AgentModelPicker,
  type AgentModelPickerValue,
} from "../composer/AgentModelPicker";
import { ChatInput } from "../composer/ChatInput";
import { ChatMessageList } from "../message/ChatMessageList";

interface SubagentTabViewProps {
  sessionId: string;
  /** The sub-agent this tab is dedicated to. */
  agentId: string;
  /** The orchestrator's home Conversation, for the "from Prime's thread" label. */
  primaryConversationId: string;
  /** Display name, used in the stop control's label. */
  name: string;
  /** This sub-agent's conversation messages, already scoped by the server room. */
  messages: ChatMessage[];
  currentAuthorId: string;
  /** Bundle this session was created from; enables `tangent-ui:` components. */
  bundleId?: string;
  /** Whether the room's history snapshot has arrived; gates loader vs empty. */
  historyLoaded: boolean;
  activity: AgentActivity | null;
  /** This sub-agent's lifecycle status; a `"killed"` agent hides its composer. */
  status: SubagentStatus;
  /** Whether this sub-agent's run is in flight. */
  busy: boolean;
  /** Disables the composer (e.g. while the socket is disconnected). */
  disabled?: boolean;
  isMessageStreaming: (messageId: string) => boolean;
  /** Aborts this sub-agent's in-progress run. */
  onAbort: () => void;
  /** Removes this (killed) sub-agent from the roster and closes its tab. */
  onRemove: () => void;
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
  /** People/agents the `@mention` picker can address in this sub-agent's composer. */
  mentionCandidates: MentionCandidate[];
}

/**
 * A single sub-agent's thread, shown in its own in-app tab. Users can steer or
 * follow-up a sub-agent directly here (mirroring the Prime composer) while its
 * run is in flight, or message it when idle.
 */
export function SubagentTabView({
  sessionId,
  agentId,
  primaryConversationId,
  name,
  messages,
  currentAuthorId,
  bundleId,
  historyLoaded,
  activity,
  status,
  busy,
  disabled,
  isMessageStreaming,
  onAbort,
  onSubmit,
  model,
  thinkingDepth,
  onSetModel,
  onOpenArtifact,
  onRemove,
  pinnedPaths,
  onTogglePinArtifact,
  mentionCandidates,
}: SubagentTabViewProps) {
  return (
    <BlockStack grow>
      <ChatMessageList
        sessionId={sessionId}
        messages={messages}
        currentAuthorId={currentAuthorId}
        primaryConversationId={primaryConversationId}
        activity={activity}
        activityAuthorName={name}
        activityAuthorRole="subagent"
        historyLoaded={historyLoaded}
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
        agentStatus={status}
        mentionCandidates={mentionCandidates}
        onRemove={onRemove}
        onAbort={onAbort}
        onSubmit={onSubmit}
      />
    </BlockStack>
  );
}
