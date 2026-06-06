import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";
import { Markdown } from "@/shared/lib/markdown/Markdown";

import { AgentThinking } from "./AgentThinking";
import { MessageBubble, type MessageBubbleVariant } from "./MessageBubble";

interface ChatMessageProps {
  sessionId: string;
  message: ChatMessageType;
  isOwn: boolean;
}

export function ChatMessage({ sessionId, message, isOwn }: ChatMessageProps) {
  const isAgent = message.author.kind === "agent";
  const isSubagent = message.author.agentRole === "subagent";
  const variant: MessageBubbleVariant = isOwn
    ? "own"
    : isAgent
      ? "agent"
      : "human";
  const roleLabel = isSubagent ? " (sub-agent)" : isAgent ? " (agent)" : "";

  return (
    <MessageBubble variant={variant}>
      <span className="text-xs font-medium text-muted-foreground">
        {message.author.name}
        {roleLabel}
      </span>
      {isAgent ? (
        <div className="flex flex-col gap-1 text-sm break-words min-w-0 overflow-x-auto">
          {message.thinking ? (
            <AgentThinking
              thinking={message.thinking}
              done={message.content.length > 0}
            />
          ) : null}
          <Markdown artifactBaseUrl={`/api/sessions/${sessionId}/files`}>
            {message.content}
          </Markdown>
        </div>
      ) : (
        <p className="text-sm break-words whitespace-pre-wrap">
          {message.content}
        </p>
      )}
    </MessageBubble>
  );
}
