import type {
  AgentActivity,
  Attachment,
  MessageDelivery,
  SubagentInfo,
  Trigger,
} from "@tangent/shared/contracts";

import type { AssetTab } from "@/features/chat/hooks/useAssetTabs";
import type { AgentModelSelection } from "@/features/chat/hooks/useSessionChat";
import type { Agent } from "@/features/chat/model/agents";
import type { MentionCandidate } from "@/features/chat/model/mentions";
import type { ChatMessage } from "@/features/chat/model/types";

import { AgentsIndicator } from "../composer/AgentsIndicator";
import { ArtifactTabView } from "./ArtifactTabView";
import { SubagentTabView } from "./SubagentTabView";
import { TriggerTabPanel } from "./TriggerTabPanel";

interface AssetTabContentProps {
  tab: AssetTab;
  sessionId: string;
  subagents: SubagentInfo[];
  conversationForAgent: (agentId: string) => string;
  primaryConversationId: string;
  triggers: Trigger[];
  messagesFor: (conversationId: string) => ChatMessage[];
  currentAuthorId: string;
  bundleId?: string;
  connected: boolean;
  historyLoaded: boolean;
  pinnedPaths: Set<string>;
  getActivity: (conversationId: string) => AgentActivity | null;
  isConversationBusy: (conversationId: string) => boolean;
  isMessageStreaming: (messageId: string) => boolean;
  getAgentModel: (agentId: string) => AgentModelSelection | null;
  setAgentModel: (agentId: string, selection: AgentModelSelection) => void;
  abort: (conversationId: string) => void;
  dismissSubagent: (id: string) => void;
  closeAsset: (id: string) => void;
  send: (
    content: string,
    options?: {
      conversationId?: string;
      delivery?: MessageDelivery;
      attachments?: Attachment[];
    },
  ) => void;
  openArtifactTab: (url: string, title: string) => void;
  togglePinArtifact: (path: string, title: string) => void;
  mentionCandidates: MentionCandidate[];
  spawnedAgents: Agent[];
  busySubagents: { id: string; conversationId: string }[];
  openAgent: (agent: Agent) => void;
  removeAgent: (agent: Agent) => void;
}

/**
 * Renders the body of an opened asset tab, dispatching by `tab.kind` to the
 * matching per-type view. `SessionChat` owns the surrounding `TabsContent`; this
 * component only resolves and renders the right view for the tab.
 */
export function AssetTabContent({
  tab,
  sessionId,
  subagents,
  conversationForAgent,
  primaryConversationId,
  triggers,
  messagesFor,
  currentAuthorId,
  bundleId,
  connected,
  historyLoaded,
  pinnedPaths,
  getActivity,
  isConversationBusy,
  isMessageStreaming,
  getAgentModel,
  setAgentModel,
  abort,
  dismissSubagent,
  closeAsset,
  send,
  openArtifactTab,
  togglePinArtifact,
  mentionCandidates,
  spawnedAgents,
  busySubagents,
  openAgent,
  removeAgent,
}: AssetTabContentProps) {
  switch (tab.kind) {
    case "agent": {
      const info = subagents.find((s) => s.id === tab.agentId);
      const model = getAgentModel(tab.agentId);
      const conversationId =
        info?.conversationId ?? conversationForAgent(tab.agentId);
      return (
        <SubagentTabView
          sessionId={sessionId}
          agentId={tab.agentId}
          primaryConversationId={primaryConversationId}
          name={info?.name ?? tab.title}
          messages={messagesFor(conversationId)}
          currentAuthorId={currentAuthorId}
          bundleId={bundleId}
          historyLoaded={historyLoaded}
          activity={getActivity(conversationId)}
          status={info?.status ?? "completed"}
          busy={isConversationBusy(conversationId)}
          disabled={!connected}
          isMessageStreaming={isMessageStreaming}
          model={model?.model}
          thinkingDepth={model?.thinkingDepth}
          onSetModel={(selection) => setAgentModel(tab.agentId, selection)}
          onAbort={() => abort(conversationId)}
          onRemove={() => {
            dismissSubagent(tab.agentId);
            closeAsset(tab.id);
          }}
          onSubmit={(content, { delivery, attachments }) =>
            send(content, {
              conversationId,
              delivery,
              attachments,
            })
          }
          onOpenArtifact={openArtifactTab}
          pinnedPaths={pinnedPaths}
          onTogglePinArtifact={togglePinArtifact}
          mentionCandidates={mentionCandidates}
          agentsPill={
            <AgentsIndicator
              sessionId={sessionId}
              agents={spawnedAgents}
              busySubagents={busySubagents}
              selectedId={tab.agentId}
              onOpenAgent={openAgent}
              onRemoveAgent={removeAgent}
              onAbort={abort}
            />
          }
        />
      );
    }
    case "trigger":
      return (
        <TriggerTabPanel
          sessionId={sessionId}
          triggerId={tab.triggerId}
          triggers={triggers}
          onClose={() => closeAsset(tab.id)}
        />
      );
    default:
      return (
        <ArtifactTabView
          sessionId={sessionId}
          url={tab.url}
          title={tab.title}
          onSendPrompt={(content, attachments) =>
            send(content, { attachments })
          }
        />
      );
  }
}
