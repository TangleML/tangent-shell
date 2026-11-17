import { Paragraph } from "@tangent/ui-primitives/typography";

import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";
import { apiUrl } from "@/shared/lib/basePath";
import { Markdown } from "@/shared/lib/markdown/Markdown";

import { CalloutMessage } from "./CalloutMessage";
import { MessageAttachments } from "./MessageAttachments";

interface ReportMessageProps {
  sessionId: string;
  message: ChatMessageType;
  bundleId?: string;
  onSendPrompt?: (text: string) => void;
  onOpenArtifact?: (url: string, title: string) => void;
  pinnedPaths?: Set<string>;
  onTogglePinArtifact?: (path: string, title: string) => void;
  onCollapse?: () => void;
}

/**
 * A Message that arrived from another Conversation (`source.kind === "relay"`),
 * rendered as a report rather than a peer turn: a bordered callout attributed to
 * whoever posted it, so a cross-conversation contribution reads as something
 * forwarded in, not as a member speaking in this thread.
 */
export function ReportMessage({
  sessionId,
  message,
  bundleId,
  onSendPrompt,
  onOpenArtifact,
  pinnedPaths,
  onTogglePinArtifact,
  onCollapse,
}: ReportMessageProps) {
  const isAgent = message.author.kind === "agent";
  const attachments = message.attachments ?? [];

  return (
    <CalloutMessage
      icon="CornerDownRight"
      title={`Report from ${message.author.name}`}
      tone="info"
      createdAt={message.createdAt}
      content={message.content}
      onCollapse={onCollapse}
    >
      {isAgent ? (
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
      ) : (
        <Paragraph size="sm" wrap="pre-wrap">
          {message.content}
        </Paragraph>
      )}
      {attachments.length > 0 ? (
        <MessageAttachments sessionId={sessionId} attachments={attachments} />
      ) : null}
    </CalloutMessage>
  );
}
