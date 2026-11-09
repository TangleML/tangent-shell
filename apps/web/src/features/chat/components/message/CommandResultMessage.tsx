import type { ChatCommandRun } from "@tangent/shared/contracts";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";

import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";
import { apiUrl } from "@/shared/lib/basePath";
import { Markdown } from "@/shared/lib/markdown/Markdown";
import { Surface } from "@/shared/ui/patterns/surface";

import { MessageActions } from "./MessageActions";

interface CommandResultMessageProps {
  sessionId: string;
  message: ChatMessageType;
  command: ChatCommandRun;
  isOwn: boolean;
  onOpenArtifact?: (url: string, title: string) => void;
  onCollapse?: () => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A slash command's result, set apart from the turns around it and saying who
 * ran what, since no agent wrote it. Everyone in the chat sees it; the agent
 * is sent it with the next message.
 */
export function CommandResultMessage({
  sessionId,
  message,
  command: { name, args },
  isOwn,
  onOpenArtifact,
  onCollapse,
}: CommandResultMessageProps) {
  const who = isOwn ? "You" : message.author.name;

  return (
    <Surface>
      <BlockStack gap="1">
        <InlineStack gap="2" wrap="nowrap">
          <Icon name="SquareSlash" size="xs" tone="subdued" />
          <Text size="xs" weight="medium" tone="subdued" truncate>
            {`${who} ran /${name}${args ? ` ${args}` : ""} · ${formatTime(message.createdAt)}`}
          </Text>
          <MessageActions content={message.content} onCollapse={onCollapse} />
        </InlineStack>
        <Markdown
          size="sm"
          artifactBaseUrl={apiUrl(`/api/sessions/${sessionId}/files`)}
          onOpenArtifact={onOpenArtifact}
          sessionId={sessionId}
          messageId={message.id}
        >
          {message.content}
        </Markdown>
      </BlockStack>
    </Surface>
  );
}
