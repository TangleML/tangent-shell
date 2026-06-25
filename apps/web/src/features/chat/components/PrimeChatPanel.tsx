import {
  type AgentActivity,
  type Attachment,
  type MemorySuggestionPayload,
  type MessageDelivery,
  PI_AGENT,
  type SubagentInfo,
  type Trigger,
} from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";

import type { AgentModelSelection } from "@/features/chat/hooks/useSessionChat";
import type { Asset } from "@/features/chat/model/assets";
import type { ChatMessage } from "@/features/chat/model/types";

import { ActiveTasksIndicator } from "./composer/ActiveTasksIndicator";
import { AgentModelPicker } from "./composer/AgentModelPicker";
import { BundlePanelLauncher } from "./composer/BundlePanelLauncher";
import { ChatInput } from "./composer/ChatInput";
import { MemorySuggestionCard } from "./composer/MemorySuggestionCard";
import { NewSessionComposer } from "./composer/NewSessionComposer";
import { ChatMessageList } from "./message/ChatMessageList";

interface DraftActions {
  onSend: (content: string) => void;
  onAttach: (files: File[], content: string) => void;
  busy?: boolean;
}

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
  draft: boolean;
  draftActions?: DraftActions;
  messages: ChatMessage[];
  currentAuthorId: string;
  bundleId?: string;
  connected: boolean;
  agentBusy: boolean;
  handoffFiles?: File[];
  activity: AgentActivity | null;
  isMessageStreaming: (messageId: string) => boolean;
  memorySuggestions: MemorySuggestionPayload[];
  confirmMemory: (suggestionId: string) => void;
  dismissMemory: (suggestionId: string) => void;
  busySubagents: { id: string; name: string }[];
  armedTriggers: Trigger[];
  subagents: SubagentInfo[];
  assets: Asset[];
  primeModel: AgentModelSelection | null;
  send: SendFn;
  abort: (conversationId: string) => void;
  openAgent: (agent: { id: string; name: string }) => void;
  openAsset: (asset: Asset) => void;
  setAgentModel: (agentId: string, selection: AgentModelSelection) => void;
  openArtifactTab: (url: string, title: string) => void;
  pinnedPaths: Set<string>;
  togglePinArtifact: (path: string, title: string) => void;
}

/**
 * Prime's main thread tab: the message list plus the composer area (memory
 * suggestions, bundle panel launcher, active-tasks footer, and the input). On
 * the new-session draft screen only the message list and the draft composer
 * render; the live-session affordances are hidden until the session exists.
 */
export function PrimeChatPanel({
  sessionId,
  draft,
  draftActions,
  messages,
  currentAuthorId,
  bundleId,
  connected,
  agentBusy,
  handoffFiles,
  activity,
  isMessageStreaming,
  memorySuggestions,
  confirmMemory,
  dismissMemory,
  busySubagents,
  armedTriggers,
  subagents,
  assets,
  primeModel,
  send,
  abort,
  openAgent,
  openAsset,
  setAgentModel,
  openArtifactTab,
  pinnedPaths,
  togglePinArtifact,
}: PrimeChatPanelProps) {
  return (
    <BlockStack grow>
      <ChatMessageList
        sessionId={sessionId}
        messages={messages}
        currentAuthorId={currentAuthorId}
        activity={activity}
        bundleId={bundleId}
        onSendPrompt={send}
        onOpenArtifact={openArtifactTab}
        pinnedPaths={pinnedPaths}
        onTogglePinArtifact={togglePinArtifact}
        isMessageStreaming={isMessageStreaming}
      />
      {!draft && memorySuggestions.length > 0 && (
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
      {!draft && bundleId && (
        <BundlePanelLauncher bundleId={bundleId} onSendPrompt={send} />
      )}
      {!draft && (
        <PrimeComposerFooter
          sessionId={sessionId}
          busySubagents={busySubagents}
          armedTriggers={armedTriggers}
          subagents={subagents}
          assets={assets}
          connected={connected}
          primeModel={primeModel}
          openAgent={openAgent}
          openAsset={openAsset}
          abort={abort}
          setAgentModel={setAgentModel}
        />
      )}
      {draft && draftActions ? (
        <NewSessionComposer
          onSend={draftActions.onSend}
          onAttach={draftActions.onAttach}
          busy={draftActions.busy}
        />
      ) : (
        <ChatInput
          key={`${sessionId}:${PI_AGENT.id}`}
          sessionId={sessionId}
          agentId={PI_AGENT.id}
          initialFiles={handoffFiles}
          disabled={!connected}
          agentBusy={agentBusy}
          onAbort={() => abort(PI_AGENT.id)}
          onSubmit={(content, { delivery, attachments }) =>
            send(content, {
              conversationId: PI_AGENT.id,
              delivery,
              attachments,
            })
          }
        />
      )}
    </BlockStack>
  );
}

interface PrimeComposerFooterProps {
  sessionId: string;
  busySubagents: { id: string; name: string }[];
  armedTriggers: Trigger[];
  subagents: SubagentInfo[];
  assets: Asset[];
  connected: boolean;
  primeModel: AgentModelSelection | null;
  openAgent: (agent: { id: string; name: string }) => void;
  openAsset: (asset: Asset) => void;
  abort: (conversationId: string) => void;
  setAgentModel: (agentId: string, selection: AgentModelSelection) => void;
}

function PrimeComposerFooter({
  sessionId,
  busySubagents,
  armedTriggers,
  subagents,
  assets,
  connected,
  primeModel,
  openAgent,
  openAsset,
  abort,
  setAgentModel,
}: PrimeComposerFooterProps) {
  return (
    <Box paddingInline="base" paddingBlock="sm">
      <InlineStack align="space-between" blockAlign="center">
        <InlineStack blockAlign="center">
          <ActiveTasksIndicator
            sessionId={sessionId}
            busySubagents={busySubagents}
            armedTriggers={armedTriggers}
            onOpenAgent={(id) =>
              openAgent({
                id,
                name: subagents.find((s) => s.id === id)?.name ?? id,
              })
            }
            onAbort={abort}
            onOpenTrigger={(id) => {
              const asset = assets.find(
                (a) => a.kind === "trigger" && a.id === id,
              );
              if (asset) openAsset(asset);
            }}
          />
        </InlineStack>
        <AgentModelPicker
          model={primeModel?.model}
          thinkingDepth={primeModel?.thinkingDepth}
          onChange={(selection) => setAgentModel(PI_AGENT.id, selection)}
          disabled={!connected}
        />
      </InlineStack>
    </Box>
  );
}
