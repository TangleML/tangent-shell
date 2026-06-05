import { useEffect, useRef } from "react";

import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";

import { ChatMessage } from "./ChatMessage";

interface ChatMessageListProps {
  messages: ChatMessageType[];
  currentAuthorId: string;
}

export function ChatMessageList({
  messages,
  currentAuthorId,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">
          No messages yet. Say hello to start the session.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
      {messages.map((msg) => (
        <ChatMessage
          key={msg.id}
          message={msg}
          isOwn={msg.author.id === currentAuthorId}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
