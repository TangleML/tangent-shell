import { useState } from "react";

import { useThinkingCollapse } from "@/features/chat/hooks/useThinkingCollapse";
import type {
  Attachment,
  ChatMessage as ChatMessageType,
} from "@/features/chat/model/types";
import { Markdown } from "@/shared/lib/markdown/Markdown";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { HoverReveal } from "@/shared/ui/patterns/hover-reveal";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { Pill } from "@/shared/ui/patterns/pill";
import { Paragraph, Text } from "@/shared/ui/typography";

import { AgentThinking, ThinkingDisclosure } from "./AgentThinking";
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

type CopiedFormat = "plain" | "markdown" | null;

function MessageCopyActions({ content }: { content: string }) {
  const [copied, setCopied] = useState<CopiedFormat>(null);
  const disabled = !content.trim();

  async function copyText(text: string, format: Exclude<CopiedFormat, null>) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(format);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard access can be denied (e.g. insecure context); fail silently.
    }
  }

  return (
    <HoverReveal>
      <InlineStack gap="0.5" wrap="nowrap">
        <IconButton
          icon={copied === "markdown" ? "Check" : "Copy"}
          size="xs"
          variant="ghost"
          disabled={disabled}
          aria-label={copied === "markdown" ? "Copied" : "Copy as Markdown"}
          onClick={() => copyText(content, "markdown")}
        />
      </InlineStack>
    </HoverReveal>
  );
}

function MessageHeader({
  authorName,
  roleLabel,
  content,
}: {
  authorName: string;
  roleLabel: string;
  content: string;
}) {
  return (
    <InlineStack align="space-between" blockAlign="center" wrap="nowrap">
      <Text size="xs" weight="medium" tone="subdued">
        {authorName}
        {roleLabel}
      </Text>
      <MessageCopyActions content={content} />
    </InlineStack>
  );
}

function isThinkingOnly(message: ChatMessageType): boolean {
  return (
    message.author.kind === "agent" &&
    Boolean(message.thinking?.trim()) &&
    !message.content.trim() &&
    !message.attachments?.length
  );
}

function isThinkingDone(
  message: ChatMessageType,
  isStreaming: boolean,
): boolean {
  return message.content.length > 0 || !isStreaming;
}

interface ChatMessageProps {
  sessionId: string;
  message: ChatMessageType;
  isOwn: boolean;
  /** Whether this message is still receiving streamed deltas. */
  isStreaming?: boolean;
  /** Bundle this session was created from; enables `tangent-ui:` components. */
  bundleId?: string;
}

/**
 * A server-emitted "remembered" highlight: a distinct, icon-marked bubble whose
 * text is the exact fact written to memory (so the user sees ground truth, not
 * the agent's claim).
 */
function MemoryMessage({ message }: { message: ChatMessageType }) {
  const scope = message.memory?.scope === "global" ? "global" : "session";
  return (
    <MessageBubble variant="memory">
      <InlineStack gap="1" blockAlign="center">
        <Icon name="Brain" size="xs" tone="accent" />
        <Text size="xs" weight="medium" tone="accent">
          Remembered ({scope})
        </Text>
      </InlineStack>
      <Paragraph size="sm" wrap="pre-wrap">
        {message.content}
      </Paragraph>
    </MessageBubble>
  );
}

function ThinkingOnlyMessage({
  message,
  variant,
  roleLabel,
  isStreaming,
}: {
  message: ChatMessageType;
  variant: MessageBubbleVariant;
  roleLabel: string;
  isStreaming: boolean;
}) {
  const thinkingDone = isThinkingDone(message, isStreaming);
  const { open, onOpenChange } = useThinkingCollapse(thinkingDone);

  return (
    <MessageBubble variant={variant} selectable={open}>
      <Text size="xs" weight="medium" tone="subdued">
        {message.author.name}
        {roleLabel}
      </Text>
      <ThinkingDisclosure
        thinking={message.thinking ?? ""}
        open={open}
        onOpenChange={onOpenChange}
      />
    </MessageBubble>
  );
}

export function ChatMessage({
  sessionId,
  message,
  isOwn,
  isStreaming = false,
  bundleId,
}: ChatMessageProps) {
  if (message.memory) return <MemoryMessage message={message} />;

  const isAgent = message.author.kind === "agent";
  const isSubagent = message.author.agentRole === "subagent";
  const variant: MessageBubbleVariant = isOwn
    ? "own"
    : isAgent
      ? "agent"
      : "human";
  const roleLabel = isSubagent ? " (sub-agent)" : isAgent ? " (agent)" : "";
  const attachments = message.attachments ?? [];

  if (isThinkingOnly(message)) {
    return (
      <ThinkingOnlyMessage
        message={message}
        variant={variant}
        roleLabel={roleLabel}
        isStreaming={isStreaming}
      />
    );
  }

  return (
    <MessageBubble variant={variant} className="group">
      <MessageHeader
        authorName={message.author.name}
        roleLabel={roleLabel}
        content={message.content}
      />
      {isAgent ? (
        <BlockStack gap="1">
          {message.thinking ? (
            <AgentThinking
              thinking={message.thinking}
              done={isThinkingDone(message, isStreaming)}
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
