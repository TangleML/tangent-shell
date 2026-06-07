import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";
import { Markdown } from "@/shared/lib/markdown/Markdown";
import { BlockStack } from "@/shared/ui/layout";
import { Paragraph, Text } from "@/shared/ui/typography";

import { AgentThinking } from "./AgentThinking";
import { MessageBubble, type MessageBubbleVariant } from "./MessageBubble";

interface ChatMessageProps {
  sessionId: string;
  message: ChatMessageType;
  isOwn: boolean;
}

export function ChatMessage({ sessionId, message, isOwn }: ChatMessageProps) {
  const isAgent = message.author.kind === "agent";
  const isSubagent = message.author.agentRole === "subagent";
  const variant: MessageBubbleVariant = isOwn
    ? "own"
    : isAgent
      ? "agent"
      : "human";
  const roleLabel = isSubagent ? " (sub-agent)" : isAgent ? " (agent)" : "";

  return (
    <MessageBubble variant={variant}>
      <Text size="xs" weight="medium" tone="subdued">
        {message.author.name}
        {roleLabel}
      </Text>
      {isAgent ? (
        <BlockStack gap="1">
          {message.thinking ? (
            <AgentThinking
              thinking={message.thinking}
              done={message.content.length > 0}
            />
          ) : null}
          <Markdown artifactBaseUrl={`/api/sessions/${sessionId}/files`}>
            {message.content}
          </Markdown>
        </BlockStack>
      ) : (
        <Paragraph size="sm" wrap="pre-wrap">
          {message.content}
        </Paragraph>
      )}
    </MessageBubble>
  );
}
