import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";
import { Markdown } from "@/shared/lib/markdown/Markdown";
import { Icon } from "@/shared/ui/icon";
import { InlineStack } from "@/shared/ui/layout";
import { Text } from "@/shared/ui/typography";

import { HeaderCollapseButton } from "./HeaderCollapseButton";
import { MessageAvatar } from "./MessageAvatar";
import { MessageLayout } from "./MessageLayout";

/**
 * A server-emitted "remembered" highlight: a distinct, icon-marked bubble whose
 * text is the exact fact written to memory (so the user sees ground truth, not
 * the agent's claim).
 */
interface MemoryMessageProps {
  message: ChatMessageType;
  onCollapse?: () => void;
}

export function MemoryMessage({ message, onCollapse }: MemoryMessageProps) {
  const scope = message.memory?.scope === "global" ? "global" : "session";
  return (
    <MessageLayout
      variant="memory"
      avatar={
        <MessageAvatar
          kind={message.author.kind}
          name={message.author.name}
          agentRole={message.author.agentRole}
        />
      }
      header={
        <InlineStack align="start" blockAlign="center" gap="2" wrap="nowrap">
          <InlineStack gap="1" blockAlign="center">
            <Icon name="Brain" size="xs" tone="accent" />
            <Text size="xs" weight="medium" tone="accent">
              Remembered ({scope})
            </Text>
          </InlineStack>
          <HeaderCollapseButton onCollapse={onCollapse} />
        </InlineStack>
      }
    >
      <Markdown size="sm">{message.content}</Markdown>
    </MessageLayout>
  );
}
