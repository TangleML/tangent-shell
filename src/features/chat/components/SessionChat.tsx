import { useSessionChat } from "@/features/chat/hooks/useSessionChat";

import { ChatInput } from "./ChatInput";
import { ChatMessageList } from "./ChatMessageList";

interface SessionChatProps {
  sessionId: string;
}

export function SessionChat({ sessionId }: SessionChatProps) {
  const { messages, connected, currentAuthorId, send } =
    useSessionChat(sessionId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span
          className={
            connected
              ? "size-2 rounded-full bg-green-500"
              : "size-2 rounded-full bg-muted-foreground"
          }
          aria-hidden
        />
        <span className="text-xs text-muted-foreground">
          {connected ? "Connected" : "Connecting..."}
        </span>
      </div>
      <ChatMessageList messages={messages} currentAuthorId={currentAuthorId} />
      <ChatInput disabled={!connected} onSubmit={send} />
    </div>
  );
}
