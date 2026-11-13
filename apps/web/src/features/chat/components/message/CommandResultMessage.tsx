import type { ChatCommandRun } from "@tangent/shared/contracts";

import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";
import { apiUrl } from "@/shared/lib/basePath";
import { Markdown } from "@/shared/lib/markdown/Markdown";

import { CalloutMessage } from "./CalloutMessage";

interface CommandResultMessageProps {
  sessionId: string;
  message: ChatMessageType;
  command: ChatCommandRun;
  isOwn: boolean;
  onOpenArtifact?: (url: string, title: string) => void;
  onCollapse?: () => void;
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
    <CalloutMessage
      icon="SquareSlash"
      title={`${who} ran /${name}${args ? ` ${args}` : ""}`}
      createdAt={message.createdAt}
      content={message.content}
      onCollapse={onCollapse}
    >
      <Markdown
        size="sm"
        artifactBaseUrl={apiUrl(`/api/sessions/${sessionId}/files`)}
        onOpenArtifact={onOpenArtifact}
        sessionId={sessionId}
        messageId={message.id}
        untrusted
      >
        {message.content}
      </Markdown>
    </CalloutMessage>
  );
}
