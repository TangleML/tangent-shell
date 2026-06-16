import {
  PI_AGENT,
  type SubagentInfo,
  type Trigger,
} from "@tangent/shared/contracts";

import {
  CHAT_TAB_VALUE,
  useAssetTabs,
} from "@/features/chat/hooks/useAssetTabs";
import { useSessionChat } from "@/features/chat/hooks/useSessionChat";
import { buildAssets } from "@/features/chat/model/assets";
import { useSession } from "@/features/sessions/hooks/useSession";
import { isViewableArtifact } from "@/shared/lib/markdown/artifact";
import { Box } from "@/shared/ui/box";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

import { AgentModelPicker } from "./AgentModelPicker";
import { ArtifactTabView } from "./ArtifactTabView";
import { AssetList } from "./AssetList";
import { AssetTabTrigger } from "./AssetTabTrigger";
import { BundlePanelLauncher } from "./BundlePanelLauncher";
import { ChatInput } from "./ChatInput";
import { ChatMessageList } from "./ChatMessageList";
import { MemorySuggestionCard } from "./MemorySuggestionCard";
import { SessionCard } from "./SessionCard";
import { SessionSwitcher } from "./SessionSwitcher";
import { SidebarColumn } from "./SidebarColumn";
import { SubagentTabTrigger } from "./SubagentTabTrigger";
import { SubagentTabView } from "./SubagentTabView";
import { TriggerTabView } from "./TriggerTabView";

interface SessionChatProps {
  sessionId: string;
}

export function SessionChat({ sessionId }: SessionChatProps) {
  const {
    messages,
    subagents,
    triggers,
    artifacts,
    pinnedPaths,
    pinArtifact,
    unpinArtifact,
    connected,
    memorySuggestions,
    confirmMemory,
    dismissMemory,
    agentBusy,
    isConversationBusy,
    getActivity,
    isMessageStreaming,
    currentAuthorId,
    send,
    abort,
    getAgentModel,
    setAgentModel,
  } = useSessionChat(sessionId);

  // Prime's current model/thinking selection (null = server default).
  const primeModel = getAgentModel(PI_AGENT.id);

  // The bundle this session was created from (if any) drives both the
  // `tangent-ui:` message tokens and the composer's panel launcher.
  const { data: session } = useSession(sessionId);
  const bundleId = session?.config?.id;

  // Opened asset tabs, each shown beside the chat in its own closeable tab.
  const { tabs, activeTab, setActiveTab, openAsset, closeAsset } =
    useAssetTabs();

  // The session's pages, files, and triggers as one uniform list of cards.
  const assets = buildAssets({ sessionId, artifacts, triggers });

  // Each sub-agent is its own tab in the strip, driven directly by the live
  // roster. Active agents float to the top so the strip is easy to scan.
  const agentTabs = sortSubagents(subagents);

  // The Chat tab is Prime's main thread; each sub-agent has its own thread tab.
  const primeMessages = messages.filter(
    (m) => m.conversationId === PI_AGENT.id,
  );

  // Opening an artifact from a chat chip mirrors opening it from the sidebar: a
  // viewable "page" asset keyed by its resolved URL, so both dedupe to one tab.
  const openArtifactTab = (url: string, title: string) => {
    openAsset({
      kind: isViewableArtifact(url) ? "page" : "file",
      id: url,
      title,
      url,
      path: url,
    });
  };

  // Pin an artifact if it isn't already pinned, else unpin it. The chip's
  // pinned state and the sidebar list both update via the `artifacts.update`
  // directive once the server confirms.
  const togglePinArtifact = (path: string, title: string) => {
    if (pinnedPaths.has(path)) {
      unpinArtifact(path);
    } else {
      pinArtifact(path, title);
    }
  };

  return (
    <BlockStack grow align="stretch">
      {/* Asset sidebar sits left of the message column; both share the row. */}
      <InlineStack grow wrap="nowrap" blockAlign="stretch">
        <SidebarColumn data-testid="sidepanel">
          <BlockStack fill inlineAlign="space-between">
            <BlockStack gap="2">
              <SessionCard
                currentSessionId={sessionId}
                name={session?.name ?? "Session"}
                rootPath={session?.rootPath}
                connected={connected}
              />
              <AssetList
                sessionId={sessionId}
                assets={assets}
                selectedId={activeTab}
                onOpen={openAsset}
                onUnpin={unpinArtifact}
              />
            </BlockStack>

            <BlockStack gap="4">
              <SessionSwitcher currentSessionId={sessionId} />
            </BlockStack>
          </BlockStack>
        </SidebarColumn>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value={CHAT_TAB_VALUE}>
              <Icon name="MessageSquare" size="xs" tone="subdued" />
              Chat
            </TabsTrigger>
            {agentTabs.map((agent) => (
              <SubagentTabTrigger
                key={agent.id}
                value={agent.id}
                name={agent.name}
                status={agent.status}
                busy={isConversationBusy(agent.id)}
              />
            ))}
            {tabs.map((tab) => (
              <AssetTabTrigger
                key={tab.id}
                value={tab.id}
                title={tab.title}
                kind={tab.kind}
                onClose={() => closeAsset(tab.id)}
              />
            ))}
          </TabsList>

          <TabsContent value={CHAT_TAB_VALUE} forceMount>
            <BlockStack grow>
              <ChatMessageList
                sessionId={sessionId}
                messages={primeMessages}
                currentAuthorId={currentAuthorId}
                activity={getActivity(PI_AGENT.id)}
                bundleId={bundleId}
                onSendPrompt={send}
                onOpenArtifact={openArtifactTab}
                pinnedPaths={pinnedPaths}
                onTogglePinArtifact={togglePinArtifact}
                isMessageStreaming={isMessageStreaming}
              />
              {memorySuggestions.length > 0 ? (
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
              ) : null}
              {bundleId ? (
                <BundlePanelLauncher bundleId={bundleId} onSendPrompt={send} />
              ) : null}
              <Box paddingInline="base" paddingBlock="sm">
                <InlineStack align="end">
                  <AgentModelPicker
                    model={primeModel?.model}
                    thinkingDepth={primeModel?.thinkingDepth}
                    onChange={(selection) =>
                      setAgentModel(PI_AGENT.id, selection)
                    }
                    disabled={!connected}
                  />
                </InlineStack>
              </Box>
              <ChatInput
                key={`${sessionId}:${PI_AGENT.id}`}
                sessionId={sessionId}
                agentId={PI_AGENT.id}
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
            </BlockStack>
          </TabsContent>

          {agentTabs.map((agent) => (
            <TabsContent key={agent.id} value={agent.id} forceMount>
              <SubagentTabView
                sessionId={sessionId}
                agentId={agent.id}
                name={agent.name}
                messages={messages}
                currentAuthorId={currentAuthorId}
                bundleId={bundleId}
                activity={getActivity(agent.id)}
                busy={isConversationBusy(agent.id)}
                disabled={!connected}
                isMessageStreaming={isMessageStreaming}
                model={getAgentModel(agent.id)?.model}
                thinkingDepth={getAgentModel(agent.id)?.thinkingDepth}
                onSetModel={(selection) => setAgentModel(agent.id, selection)}
                onAbort={() => abort(agent.id)}
                onSubmit={(content, { delivery, attachments }) =>
                  send(content, {
                    conversationId: agent.id,
                    delivery,
                    attachments,
                  })
                }
                onOpenArtifact={openArtifactTab}
                pinnedPaths={pinnedPaths}
                onTogglePinArtifact={togglePinArtifact}
              />
            </TabsContent>
          ))}

          {tabs.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} forceMount>
              {tab.kind === "trigger" ? (
                <TriggerTabPanel
                  sessionId={sessionId}
                  triggerId={tab.triggerId}
                  triggers={triggers}
                  onClose={() => closeAsset(tab.id)}
                />
              ) : (
                <ArtifactTabView
                  sessionId={sessionId}
                  url={tab.url}
                  title={tab.title}
                  onSendPrompt={(content, attachments) =>
                    send(content, { attachments })
                  }
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      </InlineStack>
    </BlockStack>
  );
}

// Active sub-agents float to the top so the live tabs are easy to scan; ended
// ones (completed/killed/error) settle after, in their most recent order.
function sortSubagents(subagents: SubagentInfo[]): SubagentInfo[] {
  return [...subagents].sort((a, b) => {
    const aActive = a.status === "active" ? 0 : 1;
    const bActive = b.status === "active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

interface TriggerTabPanelProps {
  sessionId: string;
  triggerId: string;
  triggers: Trigger[];
  onClose: () => void;
}

/**
 * Resolves a trigger tab's id against the live roster. A trigger removed
 * elsewhere (e.g. the sidebar) leaves a stale tab; surface a clear placeholder
 * rather than a blank panel until the user closes it.
 */
function TriggerTabPanel({
  sessionId,
  triggerId,
  triggers,
  onClose,
}: TriggerTabPanelProps) {
  const trigger = triggers.find((t) => t.id === triggerId);
  if (!trigger) {
    return (
      <Box padding="base">
        <EmptyState
          icon="Zap"
          title="Trigger no longer exists"
          description="This trigger was deleted. Close this tab to dismiss it."
        />
      </Box>
    );
  }
  return (
    <TriggerTabView sessionId={sessionId} trigger={trigger} onClose={onClose} />
  );
}
