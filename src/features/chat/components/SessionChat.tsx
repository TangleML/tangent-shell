import { PI_AGENT } from "@shared/contracts";
import { useMemo, useState } from "react";

import { useSessionChat } from "@/features/chat/hooks/useSessionChat";
import { useSession } from "@/features/sessions/hooks/useSession";
import { Box } from "@/shared/ui/box";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { Divider } from "@/shared/ui/patterns/divider";
import { Toolbar } from "@/shared/ui/patterns/toolbar";
import { Text } from "@/shared/ui/typography";

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
  } = useSessionChat(sessionId);

  // The bundle this session was created from (if any) drives both the
  // `tangent-ui:` message tokens and the composer's panel launcher.
  const { data: session } = useSession(sessionId);
  const bundleId = session?.config?.id;

  // Which thread is open: `null` is Prime's main thread, else a sub-agent id.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

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
        <SubagentList
          subagents={subagents}
          selectedId={isOrphaned ? null : selectedAgentId}
          onSelect={setSelectedAgentId}
          isConversationBusy={isConversationBusy}
        />
        <BlockStack grow>
          <ChatMessageList
            sessionId={sessionId}
            messages={visibleMessages}
            currentAuthorId={currentAuthorId}
            activity={getActivity(effectiveConversationId)}
            bundleId={bundleId}
            isMessageStreaming={isMessageStreaming}
          />
          {isSubagentView ? (
            <>
              <Divider orientation="horizontal" />
              <Box paddingInline="base" paddingBlock="sm">
                <Text size="xs" tone="subdued">
                  Viewing {threadName}'s thread (read-only). Humans message
                  Prime; Prime directs sub-agents.
                </Text>
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
                <BundlePanelLauncher bundleId={bundleId} onSendPrompt={send} />
              ) : null}
              <ChatInput
                sessionId={sessionId}
                disabled={!connected || agentBusy}
                onSubmit={send}
              />
            </>
          )}
        </BlockStack>
      </InlineStack>
    </BlockStack>
  );
}
