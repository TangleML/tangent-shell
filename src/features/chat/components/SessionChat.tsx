import { PI_AGENT } from "@shared/contracts";
import { useMemo, useState } from "react";

import { useSessionChat } from "@/features/chat/hooks/useSessionChat";

import { ChatInput } from "./ChatInput";
import { ChatMessageList } from "./ChatMessageList";
import { SubagentList } from "./SubagentList";

interface SessionChatProps {
  sessionId: string;
}

export function SessionChat({ sessionId }: SessionChatProps) {
  const {
    messages,
    subagents,
    connected,
    agentBusy,
    isConversationBusy,
    currentAuthorId,
    send,
  } = useSessionChat(sessionId);

  // Which thread is open: `null` is Prime's main thread, else a sub-agent id.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // The active conversation: Prime's main thread or the selected sub-agent's.
  const conversationId = selectedAgentId ?? PI_AGENT.id;
  const selectedSubagent = selectedAgentId
    ? subagents.find((s) => s.id === selectedAgentId)
    : undefined;

  // A sub-agent can leave the roster (killed/garbage-collected) while selected;
  // fall back to Prime so we never render an empty, orphaned thread.
  const isOrphaned = selectedAgentId !== null && !selectedSubagent;
  const effectiveConversationId = isOrphaned ? PI_AGENT.id : conversationId;

  const visibleMessages = useMemo(
    () =>
      messages.filter((m) => m.conversationId === effectiveConversationId),
    [messages, effectiveConversationId],
  );

  const isSubagentView = selectedSubagent !== undefined && !isOrphaned;
  const threadName = isSubagentView ? selectedSubagent.name : PI_AGENT.name;
  const threadBusy = isConversationBusy(effectiveConversationId);

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
        <span className="ml-2 text-xs font-medium">{threadName}</span>
        {threadBusy ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {threadName} is responding...
          </span>
        ) : null}
      </div>
      {/* Roster sidebar sits left of the message column; both share the row. */}
      <div className="flex min-h-0 flex-1">
        <SubagentList
          subagents={subagents}
          selectedId={isOrphaned ? null : selectedAgentId}
          onSelect={setSelectedAgentId}
          isConversationBusy={isConversationBusy}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChatMessageList
            sessionId={sessionId}
            messages={visibleMessages}
            currentAuthorId={currentAuthorId}
          />
          {isSubagentView ? (
            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
              Viewing {threadName}'s thread (read-only). Humans message Prime;
              Prime directs sub-agents.
            </div>
          ) : (
            <ChatInput disabled={!connected || agentBusy} onSubmit={send} />
          )}
        </div>
      </div>
    </div>
  );
}
