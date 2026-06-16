import { useState } from "react";

import { useThinkingCollapse } from "@/features/chat/hooks/useThinkingCollapse";
import { isThinkingOnly } from "@/features/chat/model/messageState";
import type {
  Attachment,
  ChatMessage as ChatMessageType,
} from "@/features/chat/model/types";
import { apiUrl } from "@/shared/lib/basePath";
import { Markdown } from "@/shared/lib/markdown/Markdown";
import { Button } from "@/shared/ui/button";
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
          href={apiUrl(`/api/sessions/${sessionId}/files/${attachment.path}`)}
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

function CopyButton({ content }: { content: string }) {
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
    <IconButton
      icon={copied === "markdown" ? "Check" : "Copy"}
      size="xs"
      variant="ghost"
      disabled={disabled}
      aria-label={copied === "markdown" ? "Copied" : "Copy as Markdown"}
      onClick={() => copyText(content, "markdown")}
    />
  );
}

/** Hover-revealed row of message-level actions (copy, collapse). */
function MessageActions({
  content,
  onCollapse,
}: {
  content: string;
  onCollapse?: () => void;
}) {
  return (
    <HoverReveal>
      <InlineStack gap="0.5" wrap="nowrap">
        <CopyButton content={content} />
        {onCollapse ? (
          <IconButton
            icon="ChevronUp"
            size="xs"
            variant="ghost"
            aria-label="Collapse message"
            onClick={onCollapse}
          />
        ) : null}
      </InlineStack>
    </HoverReveal>
  );
}

function MessageHeader({
  authorName,
  roleLabel,
  content,
  onCollapse,
}: {
  authorName: string;
  roleLabel: string;
  content: string;
  onCollapse?: () => void;
}) {
  return (
    <InlineStack align="space-between" blockAlign="center" wrap="nowrap">
      <Text size="xs" weight="medium" tone="subdued">
        {authorName}
        {roleLabel}
      </Text>
      <MessageActions content={content} onCollapse={onCollapse} />
    </InlineStack>
  );
}

function roleLabelFor(message: ChatMessageType): string {
  const isAgent = message.author.kind === "agent";
  const isSubagent = message.author.agentRole === "subagent";
  return isSubagent ? " (sub-agent)" : isAgent ? " (agent)" : "";
}

/** Standalone collapse control for headers that lack a copy action. */
function HeaderCollapseButton({ onCollapse }: { onCollapse?: () => void }) {
  if (!onCollapse) return null;
  return (
    <HoverReveal>
      <IconButton
        icon="ChevronUp"
        size="xs"
        variant="ghost"
        aria-label="Collapse message"
        onClick={onCollapse}
      />
    </HoverReveal>
  );
}

/**
 * A single collapsed message: just the author and an Expand affordance, with no
 * bubble. Not selectable/copyable (the content is hidden until expanded).
 */
export function CollapsedMessage({
  message,
  onExpand,
}: {
  message: ChatMessageType;
  onExpand: () => void;
}) {
  // Raw <div> for the `select-none` escape hatch (collapsed content is hidden
  // and intentionally not selectable/copyable), exempt from
  // tangle-ui/no-classname-on-primitives.
  return (
    <div className="select-none">
      <InlineStack gap="2" blockAlign="center" wrap="nowrap">
        <Text size="xs" weight="medium" tone="subdued">
          {message.author.name}
          {roleLabelFor(message)}
        </Text>
        <Button variant="ghost" size="xs" onClick={onExpand}>
          <Icon name="ChevronDown" size="xs" />
          Expand
        </Button>
      </InlineStack>
    </div>
  );
}

/**
 * A run of 2+ consecutive collapsed messages, shown as a single "<n> messages
 * hidden" affordance that expands the entire run on click.
 */
export function CollapsedMessageGroup({
  count,
  onExpandAll,
}: {
  count: number;
  onExpandAll: () => void;
}) {
  // Raw <div> for the `select-none` escape hatch, exempt from
  // tangle-ui/no-classname-on-primitives.
  return (
    <div className="select-none">
      <Button variant="ghost" size="xs" tone="default" onClick={onExpandAll}>
        <Icon name="ChevronDown" size="xs" />
        {count} messages hidden
      </Button>
    </div>
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
  /** Forwards a prompt composed by an interactive `tangent-ui:` component. */
  onSendPrompt?: (text: string) => void;
  /** Opens a browser-viewable "page" artifact in an in-app tab. */
  onOpenArtifact?: (url: string, title: string) => void;
  /** The set of currently pinned artifact paths, for chip pin state. */
  pinnedPaths?: Set<string>;
  /** Toggles an artifact's pinned state from its chip. */
  onTogglePinArtifact?: (path: string, title: string) => void;
  /** Collapses this message into the hidden state; omitted disables collapse. */
  onCollapse?: () => void;
}

/**
 * A server-emitted "remembered" highlight: a distinct, icon-marked bubble whose
 * text is the exact fact written to memory (so the user sees ground truth, not
 * the agent's claim).
 */
function MemoryMessage({
  message,
  onCollapse,
}: {
  message: ChatMessageType;
  onCollapse?: () => void;
}) {
  const scope = message.memory?.scope === "global" ? "global" : "session";
  return (
    <MessageBubble variant="memory" className="group">
      <InlineStack align="space-between" blockAlign="center" wrap="nowrap">
        <InlineStack gap="1" blockAlign="center">
          <Icon name="Brain" size="xs" tone="accent" />
          <Text size="xs" weight="medium" tone="accent">
            Remembered ({scope})
          </Text>
        </InlineStack>
        <HeaderCollapseButton onCollapse={onCollapse} />
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
  onCollapse,
}: {
  message: ChatMessageType;
  variant: MessageBubbleVariant;
  roleLabel: string;
  isStreaming: boolean;
  onCollapse?: () => void;
}) {
  const thinkingDone = isThinkingDone(message, isStreaming);
  const { open, onOpenChange } = useThinkingCollapse(thinkingDone);

  return (
    <MessageBubble variant={variant} selectable={open} className="group">
      <InlineStack align="space-between" blockAlign="center" wrap="nowrap">
        <Text size="xs" weight="medium" tone="subdued">
          {message.author.name}
          {roleLabel}
        </Text>
        <HeaderCollapseButton onCollapse={onCollapse} />
      </InlineStack>
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
  onSendPrompt,
  onOpenArtifact,
  pinnedPaths,
  onTogglePinArtifact,
  onCollapse,
}: ChatMessageProps) {
  if (message.memory)
    return <MemoryMessage message={message} onCollapse={onCollapse} />;

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
        onCollapse={onCollapse}
      />
    );
  }

  return (
    <MessageBubble variant={variant} className="group">
      <MessageHeader
        authorName={message.author.name}
        roleLabel={roleLabel}
        content={message.content}
        onCollapse={onCollapse}
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
            artifactBaseUrl={apiUrl(`/api/sessions/${sessionId}/files`)}
            bundleId={bundleId}
            onSendPrompt={onSendPrompt}
            onOpenArtifact={onOpenArtifact}
            pinnedPaths={pinnedPaths}
            onTogglePinArtifact={onTogglePinArtifact}
            sessionId={sessionId}
            messageId={message.id}
            onCollapse={onCollapse}
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
