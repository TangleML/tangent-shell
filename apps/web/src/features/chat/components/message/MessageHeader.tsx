import { Icon } from "@tangent/ui-primitives/icon";
import { InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";

import { formatMessageTime } from "@/features/chat/model/messageTime";

import { MessageActions } from "./MessageActions";

interface MessageHeaderProps {
  authorName: string;
  roleLabel: string;
  createdAt: string;
  content: string;
  /** Where the author wrote this from, when it was not this conversation. */
  origin?: string;
  onCollapse?: () => void;
}

export function MessageHeader({
  authorName,
  roleLabel,
  createdAt,
  content,
  origin,
  onCollapse,
}: MessageHeaderProps) {
  return (
    <InlineStack align="start" blockAlign="center" gap="2" wrap="nowrap">
      <Text size="xs" weight="medium" tone="subdued">
        {authorName}
        {roleLabel}
        {" · "}
        {formatMessageTime(createdAt)}
      </Text>
      {origin ? (
        <InlineStack gap="1" blockAlign="center" wrap="nowrap">
          <Icon name="CornerDownRight" size="xs" tone="subdued" />
          <Text size="xs" tone="subdued">
            {origin}
          </Text>
        </InlineStack>
      ) : null}
      <MessageActions content={content} onCollapse={onCollapse} />
    </InlineStack>
  );
}
