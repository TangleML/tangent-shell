import { PI_AGENT } from "@shared/contracts";
import { useMemo, useState } from "react";

import {
  CHAT_TAB_VALUE,
  useArtifactTabs,
} from "@/features/chat/hooks/useArtifactTabs";
import { useSessionChat } from "@/features/chat/hooks/useSessionChat";
import { useSession } from "@/features/sessions/hooks/useSession";
import { TriggerList } from "@/features/triggers/components/TriggerList";
import { Box } from "@/shared/ui/box";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { Divider } from "@/shared/ui/patterns/divider";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { Toolbar } from "@/shared/ui/patterns/toolbar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Text } from "@/shared/ui/typography";

import { ArtifactTabTrigger } from "./ArtifactTabTrigger";
import { ArtifactTabView } from "./ArtifactTabView";
import { BundlePanelLauncher } from "./BundlePanelLauncher";
import { ChatInput } from "./ChatInput";
import { ChatMessageList } from "./ChatMessageList";
import { MemorySuggestionCard } from "./MemorySuggestionCard";
import { StatusDot } from "./StatusDot";
import { SubagentList } from "./SubagentList";

interface SessionChatProps {
  sessionId: string;
}

export function SessionChat({ sessionId }: SessionChatProps) {
  const {
    messages,
    subagents,
    triggers,
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
  } = useSessionChat(sessionId);

  // The bundle this session was created from (if any) drives both the
  // `tangent-ui:` message tokens and the composer's panel launcher.
  const { data: session } = useSession(sessionId);
  const bundleId = session?.config?.id;

  // Which thread is open: `null` is Prime's main thread, else a sub-agent id.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // Opened "page" artifacts, each shown beside the chat in its own closeable tab.
  const { tabs, activeTab, setActiveTab, openArtifact, closeArtifact } =
    useArtifactTabs();

  // The active conversation: Prime's main thread or the selected sub-agent's.
  const conversationId = selectedAgentId ?? PI_AGENT.id;
  const selectedSubagent = selectedAgentId
    ? subagents.find((s) => s.id === selectedAgentId)
    : undefined;

  // A sub-agent can leave the roster (killed/garbage-collected) while selected;
  // fall back to Prime so we never render an empty, orphaned thread.
  const isOrphaned = selectedAgentId !== null && !selectedSubagent;
  const effectiveConversationId = isOrphaned ? PI_AGENT.id : conversationId;

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.conversationId === effectiveConversationId),
    [messages, effectiveConversationId],
  );

  const isSubagentView = selectedSubagent !== undefined && !isOrphaned;
  const threadName = isSubagentView ? selectedSubagent.name : PI_AGENT.name;
  const threadBusy = isConversationBusy(effectiveConversationId);

  return (
    <BlockStack grow align="stretch">
      <Toolbar chrome="light" gap="2" align="space-between">
        <InlineStack gap="2" blockAlign="center" wrap="nowrap">
          <StatusDot connected={connected} />
          <Text size="xs" tone="subdued">
            {connected ? "Connected" : "Connecting..."}
          </Text>
          <Text size="xs" weight="medium">
            {threadName}
          </Text>
        </InlineStack>
        {threadBusy ? (
          <Text size="xs" tone="subdued">
            {threadName} is responding...
          </Text>
        ) : null}
      </Toolbar>
      {/* Roster sidebar sits left of the message column; both share the row. */}
      <InlineStack grow wrap="nowrap" blockAlign="stretch">
        <Box>
          <BlockStack gap="2">
            <SubagentList
              subagents={subagents}
              selectedId={isOrphaned ? null : selectedAgentId}
              onSelect={setSelectedAgentId}
              isConversationBusy={isConversationBusy}
            />
            <TriggerList sessionId={sessionId} triggers={triggers} />
          </BlockStack>
        </Box>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value={CHAT_TAB_VALUE}>
              <Icon name="MessageSquare" size="xs" tone="subdued" />
              Chat
            </TabsTrigger>
            {tabs.map((tab) => (
              <ArtifactTabTrigger
                key={tab.id}
                value={tab.id}
                title={tab.title}
                onClose={() => closeArtifact(tab.id)}
              />
            ))}
          </TabsList>

          <TabsContent value={CHAT_TAB_VALUE} forceMount>
            <BlockStack grow>
              <ChatMessageList
                sessionId={sessionId}
                messages={visibleMessages}
                currentAuthorId={currentAuthorId}
                activity={getActivity(effectiveConversationId)}
                bundleId={bundleId}
                onSendPrompt={isSubagentView ? undefined : send}
                onOpenArtifact={openArtifact}
                isMessageStreaming={isMessageStreaming}
              />
              {isSubagentView ? (
                <>
                  <Divider orientation="horizontal" />
                  <Box paddingInline="base" paddingBlock="sm">
                    <InlineStack
                      gap="2"
                      blockAlign="center"
                      align="space-between"
                      wrap="nowrap"
                    >
                      <Text size="xs" tone="subdued">
                        Viewing {threadName}'s thread (read-only). Humans
                        message Prime; Prime directs sub-agents.
                      </Text>
                      {threadBusy ? (
                        <IconButton
                          icon="Square"
                          variant="outline"
                          size="sm"
                          onClick={() => abort(effectiveConversationId)}
                          aria-label={`Stop ${threadName}`}
                        />
                      ) : null}
                    </InlineStack>
                  </Box>
                </>
              ) : (
                <>
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
                    <BundlePanelLauncher
                      bundleId={bundleId}
                      onSendPrompt={send}
                    />
                  ) : null}
                  <ChatInput
                    sessionId={sessionId}
                    disabled={!connected || agentBusy}
                    agentBusy={agentBusy}
                    onAbort={() => abort(PI_AGENT.id)}
                    onSubmit={send}
                  />
                </>
              )}
            </BlockStack>
          </TabsContent>

          {tabs.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} forceMount>
              <ArtifactTabView
                sessionId={sessionId}
                url={tab.url}
                title={tab.title}
                onSendPrompt={send}
              />
            </TabsContent>
          ))}
        </Tabs>
      </InlineStack>
    </BlockStack>
  );
}
