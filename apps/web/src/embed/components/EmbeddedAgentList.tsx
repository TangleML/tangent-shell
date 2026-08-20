import { Box } from "@tangent/ui-primitives/box";

import { AgentList } from "@/features/chat/components/sidebar/agents/AgentList";
import { useSessionChat } from "@/features/chat/hooks/useSessionChat";
import { type Agent, buildAgents } from "@/features/chat/model/agents";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";

import type { EmbedAgentPayload } from "../types";

interface EmbeddedAgentListProps {
  sessionId: string;
  selectedId?: string;
  onOpen: (agent: EmbedAgentPayload) => void;
  onRemove: (id: string) => void;
}

function toPayload(agent: Agent, conversationId: string): EmbedAgentPayload {
  return {
    id: agent.id,
    name: agent.name,
    kind: agent.kind,
    status: agent.status,
    conversationId,
  };
}

/**
 * The embedded agent list: Prime plus the live sub-agent roster. Clicking a
 * card emits `onOpen` so the host can place a `<Chat agentId>`; dismissing a
 * killed sub-agent updates the shared session room and notifies the host.
 */
export function EmbeddedAgentList({
  sessionId,
  selectedId,
  onOpen,
  onRemove,
}: EmbeddedAgentListProps) {
  const chat = useSessionChat(sessionId);
  const agents = buildAgents(chat.subagents);

  return (
    <ScrollRegion>
      <Box inlineSize="full">
        <AgentList
          agents={agents}
          sessionId={sessionId}
          selectedId={selectedId ?? null}
          onOpen={(agent) =>
            onOpen(toPayload(agent, chat.conversationForAgent(agent.id)))
          }
          onRemove={(agent) => {
            chat.dismissSubagent(agent.id);
            onRemove(agent.id);
          }}
        />
      </Box>
    </ScrollRegion>
  );
}
