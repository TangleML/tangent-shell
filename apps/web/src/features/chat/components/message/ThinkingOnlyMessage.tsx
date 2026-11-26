import { InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import type { ReactNode } from "react";

import { useThinkingCollapse } from "@/features/chat/hooks/useThinkingCollapse";
import { isThinkingDone } from "@/features/chat/model/messageState";
import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";
import { Markdown } from "@/shared/lib/markdown/Markdown";

import { MessageAvatar } from "./MessageAvatar";
import type { MessageBubbleVariant } from "./MessageBubble";
import { MessageLayout } from "./MessageLayout";

interface ThinkingOnlyMessageProps {
  message: ChatMessageType;
  variant: MessageBubbleVariant;
  roleLabel: string;
  isStreaming: boolean;
  actions: ReactNode;
}

export function ThinkingOnlyMessage({
  message,
  variant,
  roleLabel,
  isStreaming,
  actions,
}: ThinkingOnlyMessageProps) {
  const thinkingDone = isThinkingDone(message, isStreaming);
  const { open } = useThinkingCollapse(thinkingDone);

  return (
    <MessageLayout
      variant={variant}
      selectable={open}
      avatar={
        <MessageAvatar
          kind={message.author.kind}
          name={message.author.name}
          agentRole={message.author.agentRole}
        />
      }
      header={
        <InlineStack align="start" blockAlign="center" gap="2" wrap="nowrap">
          <Text size="xs" weight="medium" tone="subdued">
            {message.author.name}
            {roleLabel}
          </Text>
          {actions}
        </InlineStack>
      }
    >
      <Markdown size="xs" tone="subdued">
        {message.thinking ?? ""}
      </Markdown>
    </MessageLayout>
  );
}
