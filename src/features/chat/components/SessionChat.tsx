import { PI_AGENT } from "@shared/contracts";
import { useMemo, useState } from "react";

import { useSessionChat } from "@/features/chat/hooks/useSessionChat";
import { Box } from "@/shared/ui/box";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { Divider } from "@/shared/ui/patterns/divider";
import { Toolbar } from "@/shared/ui/patterns/toolbar";
import { Text } from "@/shared/ui/typography";

import { ChatInput } from "./ChatInput";
import { ChatMessageList } from "./ChatMessageList";
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
    agentBusy,
    isConversationBusy,
    currentAuthorId,
    send,
  } = useSessionChat(sessionId);

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
    <BlockStack grow>
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
      <InlineStack fill wrap="nowrap" blockAlign="stretch">
        <SubagentList
          subagents={subagents}
          selectedId={isOrphaned ? null : selectedAgentId}
          onSelect={setSelectedAgentId}
          isConversationBusy={isConversationBusy}
        />
        <BlockStack grow fill>
          <ChatMessageList
            sessionId={sessionId}
            messages={visibleMessages}
            currentAuthorId={currentAuthorId}
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
            <ChatInput disabled={!connected || agentBusy} onSubmit={send} />
          )}
        </BlockStack>
      </InlineStack>
    </BlockStack>
  );
}
