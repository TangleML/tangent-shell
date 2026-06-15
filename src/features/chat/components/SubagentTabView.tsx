import type { AgentActivity } from "@shared/contracts";
import { useMemo } from "react";

import type { ChatMessage } from "@/features/chat/model/types";
import { Box } from "@/shared/ui/box";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { Divider } from "@/shared/ui/patterns/divider";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { Text } from "@/shared/ui/typography";

import { ChatMessageList } from "./ChatMessageList";

interface SubagentTabViewProps {
  sessionId: string;
  /** The sub-agent (and conversation) this tab is dedicated to. */
  agentId: string;
  /** Display name, used in the read-only banner and stop control. */
  name: string;
  /** All chat messages; filtered to this sub-agent's conversation. */
  messages: ChatMessage[];
  currentAuthorId: string;
  /** Bundle this session was created from; enables `tangent-ui:` components. */
  bundleId?: string;
  activity: AgentActivity | null;
  /** Whether this sub-agent's run is in flight. */
  busy: boolean;
  isMessageStreaming: (messageId: string) => boolean;
  /** Aborts this sub-agent's in-progress run. */
  onAbort: () => void;
  /** Opens a browser-viewable artifact referenced in a message. */
  onOpenArtifact: (url: string, title: string) => void;
  pinnedPaths: Set<string>;
  onTogglePinArtifact: (path: string, title: string) => void;
}

/**
 * A single sub-agent's read-only thread, shown in its own in-app tab. Humans
 * only message Prime (the Chat tab); Prime directs sub-agents, so this view is
 * view-only with a stop control while the sub-agent's run is in flight.
 */
export function SubagentTabView({
  sessionId,
  agentId,
  name,
  messages,
  currentAuthorId,
  bundleId,
  activity,
  busy,
  isMessageStreaming,
  onAbort,
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
      <Divider orientation="horizontal" />
      <Box paddingInline="base" paddingBlock="sm">
        <InlineStack
          gap="2"
          blockAlign="center"
          align="space-between"
          wrap="nowrap"
        >
          <Text size="xs" tone="subdued">
            Viewing {name}'s thread (read-only). Humans message Prime; Prime
            directs sub-agents.
          </Text>
          {busy ? (
            <IconButton
              icon="Square"
              variant="outline"
              size="sm"
              onClick={onAbort}
              aria-label={`Stop ${name}`}
            />
          ) : null}
        </InlineStack>
      </Box>
    </BlockStack>
  );
}
