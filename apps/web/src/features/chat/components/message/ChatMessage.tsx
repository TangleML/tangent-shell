import { BlockStack } from "@tangent/ui-primitives/layout";
import { Paragraph } from "@tangent/ui-primitives/typography";
import { useState } from "react";

import {
  isThinkingDone,
  isThinkingOnly,
} from "@/features/chat/model/messageState";
import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";
import { apiUrl } from "@/shared/lib/basePath";
import { Markdown } from "@/shared/lib/markdown/Markdown";
import { cn } from "@/shared/lib/utils";

import { AgentThinking } from "./AgentThinking";
import { MemoryMessage } from "./MemoryMessage";
import { MessageAttachments } from "./MessageAttachments";
import { MessageAvatar } from "./MessageAvatar";
import type { MessageBubbleVariant } from "./MessageBubble";
import { MessageHeader } from "./MessageHeader";
import { MessageLayout } from "./MessageLayout";
import { roleLabelFor } from "./messageRole";
import { ThinkingOnlyMessage } from "./ThinkingOnlyMessage";

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

function ChatMessageContent({
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
    return (
      <MemoryMessage
        sessionId={sessionId}
        message={message}
        onCollapse={onCollapse}
      />
    );

  const isAgent = message.author.kind === "agent";
  const variant: MessageBubbleVariant = isOwn
    ? "own"
    : isAgent
      ? "agent"
      : "human";
  const roleLabel = roleLabelFor(message);
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
    <MessageLayout
      variant={variant}
      avatar={
        <MessageAvatar
          kind={message.author.kind}
          name={message.author.name}
          agentRole={message.author.agentRole}
          email={message.author.kind === "human" ? message.author.id : undefined}
        />
      }
      header={
        <MessageHeader
          authorName={message.author.name}
          roleLabel={roleLabel}
          createdAt={message.createdAt}
          content={message.content}
          onCollapse={onCollapse}
        />
      }
    >
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
        <MessageAttachments sessionId={sessionId} attachments={attachments} />
      ) : null}
    </MessageLayout>
  );
}

/**
 * Wraps a message in a "genie" collapse animation: pressing collapse warps the
 * bubble toward its top-left corner (where the collapsed pill appears) before
 * firing the real `onCollapse` on animation end. Raw `<div>` + `className` is
 * the sanctioned escape hatch used elsewhere in this file, exempt from
 * tangle-ui/no-classname-on-primitives.
 */
export function ChatMessage(props: ChatMessageProps) {
  const { onCollapse } = props;
  const [collapsing, setCollapsing] = useState(false);
  const requestCollapse = onCollapse ? () => setCollapsing(true) : undefined;

  const content = (
    <ChatMessageContent {...props} onCollapse={requestCollapse} />
  );

  if (!onCollapse) return content;
  return (
    <div className={cn("w-full", collapsing && "genie-collapsing")}>
      <div
        className={collapsing ? "genie-warp" : undefined}
        onAnimationEnd={collapsing ? onCollapse : undefined}
      >
        {content}
      </div>
    </div>
  );
}
