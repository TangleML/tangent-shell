import { Icon } from "@tangent/ui-primitives/icon";
import { InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import type { ReactNode } from "react";

import { formatMessageTime } from "@/features/chat/model/messageTime";

interface MessageHeaderProps {
  authorName: string;
  roleLabel: string;
  createdAt: string;
  actions: ReactNode;
  /** Where the author wrote this from, when it was not this conversation. */
  origin?: string;
}

export function MessageHeader({
  authorName,
  roleLabel,
  createdAt,
  actions,
  origin,
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
      {actions}
    </InlineStack>
  );
}
