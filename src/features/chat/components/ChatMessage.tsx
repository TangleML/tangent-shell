import type {
  Attachment,
  ChatMessage as ChatMessageType,
} from "@/features/chat/model/types";
import { Markdown } from "@/shared/lib/markdown/Markdown";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { Pill } from "@/shared/ui/patterns/pill";
import { Paragraph, Text } from "@/shared/ui/typography";

import { AgentThinking } from "./AgentThinking";
import { MessageBubble, type MessageBubbleVariant } from "./MessageBubble";

/** Renders the message's attached files as links to the session file API. */
function Attachments({
  sessionId,
  attachments,
}: {
  sessionId: string;
  attachments: Attachment[];
}) {
  return (
    <InlineStack gap="1" wrap="wrap">
      {attachments.map((attachment) => (
        <a
          key={attachment.path}
          href={`/api/sessions/${sessionId}/files/${attachment.path}`}
          target="_blank"
          rel="noreferrer"
        >
          <Pill tone="subdued" hoverable title={attachment.name}>
            <Icon name="File" size="xs" />
            {attachment.name}
          </Pill>
        </a>
      ))}
    </InlineStack>
  );
}

interface ChatMessageProps {
  sessionId: string;
  message: ChatMessageType;
  isOwn: boolean;
  /** Bundle this session was created from; enables `tangent-ui:` components. */
  bundleId?: string;
}

export function ChatMessage({
  sessionId,
  message,
  isOwn,
  bundleId,
}: ChatMessageProps) {
  const isAgent = message.author.kind === "agent";
  const isSubagent = message.author.agentRole === "subagent";
  const variant: MessageBubbleVariant = isOwn
    ? "own"
    : isAgent
      ? "agent"
      : "human";
  const roleLabel = isSubagent ? " (sub-agent)" : isAgent ? " (agent)" : "";
  const attachments = message.attachments ?? [];

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
          <Markdown
            artifactBaseUrl={`/api/sessions/${sessionId}/files`}
            bundleId={bundleId}
          >
            {message.content}
          </Markdown>
        </BlockStack>
      ) : (
        <Paragraph size="sm" wrap="pre-wrap">
          {message.content}
        </Paragraph>
      )}
      {attachments.length > 0 ? (
        <Attachments sessionId={sessionId} attachments={attachments} />
      ) : null}
    </MessageBubble>
  );
}
