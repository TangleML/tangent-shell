import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";
import { Markdown } from "@/shared/lib/markdown/Markdown";

import { MessageBubble, type MessageBubbleVariant } from "./MessageBubble";

interface ChatMessageProps {
  message: ChatMessageType;
  isOwn: boolean;
}

export function ChatMessage({ message, isOwn }: ChatMessageProps) {
  const isAgent = message.author.kind === "agent";
  const variant: MessageBubbleVariant = isOwn
    ? "own"
    : isAgent
      ? "agent"
      : "human";

  return (
    <MessageBubble variant={variant}>
      <span className="text-xs font-medium text-muted-foreground">
        {message.author.name}
        {isAgent ? " (agent)" : ""}
      </span>
      {isAgent ? (
        <div className="text-sm break-words min-w-0 overflow-x-auto">
          <Markdown>{message.content}</Markdown>
        </div>
      ) : (
        <p className="text-sm break-words whitespace-pre-wrap">
          {message.content}
        </p>
      )}
    </MessageBubble>
  );
}
