import {
  type AgentActivity,
  type Attachment,
  type MemorySuggestionPayload,
  type MessageDelivery,
  PI_AGENT,
} from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";
import { BlockStack } from "@tangent/ui-primitives/layout";

import type { AgentModelSelection } from "@/features/chat/hooks/useSessionChat";
import type { Agent } from "@/features/chat/model/agents";
import type { MentionCandidate } from "@/features/chat/model/mentions";
import type { ChatReference } from "@/features/chat/model/references";
import type { ChatMessage } from "@/features/chat/model/types";

import { AgentModelPicker } from "./composer/AgentModelPicker";
import { AgentsIndicator } from "./composer/AgentsIndicator";
import { BundlePanelLauncher } from "./composer/BundlePanelLauncher";
import { ChatInput } from "./composer/ChatInput";
import { ComposerFooter } from "./composer/ComposerFooter";
import { MemorySuggestionCard } from "./composer/MemorySuggestionCard";
import { ChatMessageList } from "./message/ChatMessageList";

type SendFn = (
  content: string,
  options?: {
    conversationId?: string;
    delivery?: MessageDelivery;
    attachments?: Attachment[];
  },
) => void;

interface PrimeChatPanelProps {
  sessionId: string;
  /** The orchestrator's home Conversation this panel sends/aborts against. */
  primaryConversationId: string;
  messages: ChatMessage[];
  currentAuthorId: string;
  bundleId?: string;
  connected: boolean;
  historyLoaded: boolean;
  agentBusy: boolean;
  activity: AgentActivity | null;
  isMessageStreaming: (messageId: string) => boolean;
  memorySuggestions: MemorySuggestionPayload[];
  confirmMemory: (suggestionId: string) => void;
  dismissMemory: (suggestionId: string) => void;
  busySubagents: { id: string; name: string; conversationId: string }[];
  /** The sub-agents spawned in this session, without Prime. */
  spawnedAgents: Agent[];
  primeModel: AgentModelSelection | null;
  send: SendFn;
  abort: (conversationId: string) => void;
  openAgent: (agent: Agent) => void;
  removeAgent: (agent: Agent) => void;
  setAgentModel: (agentId: string, selection: AgentModelSelection) => void;
  openArtifactTab: (url: string, title: string) => void;
  pinnedPaths: Set<string>;
  togglePinArtifact: (path: string, title: string) => void;
  mentionCandidates: MentionCandidate[];
  references: ChatReference[];
}

export function PrimeChatPanel({
  sessionId,
  primaryConversationId,
  messages,
  currentAuthorId,
  bundleId,
  connected,
  historyLoaded,
  agentBusy,
  activity,
  isMessageStreaming,
  memorySuggestions,
  confirmMemory,
  dismissMemory,
  busySubagents,
  spawnedAgents,
  primeModel,
  send,
  abort,
  openAgent,
  removeAgent,
  setAgentModel,
  openArtifactTab,
  pinnedPaths,
  togglePinArtifact,
  mentionCandidates,
  references,
}: PrimeChatPanelProps) {
  return (
    <BlockStack grow>
      <ChatMessageList
        sessionId={sessionId}
        messages={messages}
        currentAuthorId={currentAuthorId}
        primaryConversationId={primaryConversationId}
        activity={activity}
        activityAuthorName={PI_AGENT.name}
        activityAuthorRole="prime"
        historyLoaded={historyLoaded}
        bundleId={bundleId}
        onSendPrompt={send}
        onOpenArtifact={openArtifactTab}
        pinnedPaths={pinnedPaths}
        onTogglePinArtifact={togglePinArtifact}
        isMessageStreaming={isMessageStreaming}
      />
      {memorySuggestions.length > 0 && (
        <Box paddingInline="base" paddingBlock="sm">
          <BlockStack gap="2">
            {memorySuggestions.map((suggestion) => (
              <MemorySuggestionCard
                key={suggestion.suggestionId}
                suggestion={suggestion}
                onConfirm={confirmMemory}
                onDismiss={dismissMemory}
              />
            ))}
          </BlockStack>
        </Box>
      )}
      {bundleId && (
        <BundlePanelLauncher bundleId={bundleId} onSendPrompt={send} />
      )}
      <PrimeComposerFooter
        sessionId={sessionId}
        busySubagents={busySubagents}
        spawnedAgents={spawnedAgents}
        connected={connected}
        primeModel={primeModel}
        openAgent={openAgent}
        removeAgent={removeAgent}
        abort={abort}
        setAgentModel={setAgentModel}
      />
      <ChatInput
        key={`${sessionId}:${PI_AGENT.id}`}
        sessionId={sessionId}
        agentId={PI_AGENT.id}
        disabled={!connected}
        agentBusy={agentBusy}
        mentionCandidates={mentionCandidates}
        references={references}
        onAbort={() => abort(primaryConversationId)}
        onSubmit={(content, { delivery, attachments }) =>
          send(content, {
            conversationId: primaryConversationId,
            delivery,
            attachments,
          })
        }
      />
    </BlockStack>
  );
}

interface PrimeComposerFooterProps {
  sessionId: string;
  busySubagents: { id: string; name: string; conversationId: string }[];
  spawnedAgents: Agent[];
  connected: boolean;
  primeModel: AgentModelSelection | null;
  openAgent: (agent: Agent) => void;
  removeAgent: (agent: Agent) => void;
  abort: (conversationId: string) => void;
  setAgentModel: (agentId: string, selection: AgentModelSelection) => void;
}

function PrimeComposerFooter({
  sessionId,
  busySubagents,
  spawnedAgents,
  connected,
  primeModel,
  openAgent,
  removeAgent,
  abort,
  setAgentModel,
}: PrimeComposerFooterProps) {
  return (
    <ComposerFooter
      agentsPill={
        <AgentsIndicator
          sessionId={sessionId}
          agents={spawnedAgents}
          busySubagents={busySubagents}
          onOpenAgent={openAgent}
          onRemoveAgent={removeAgent}
          onAbort={abort}
        />
      }
      modelPicker={
        <AgentModelPicker
          model={primeModel?.model}
          thinkingDepth={primeModel?.thinkingDepth}
          onChange={(selection) => setAgentModel(PI_AGENT.id, selection)}
          disabled={!connected}
        />
      }
    />
  );
}
