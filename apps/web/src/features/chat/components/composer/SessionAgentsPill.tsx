import { BlockStack } from "@tangent/ui-primitives/layout";

import { useSessionChat } from "@/features/chat/hooks/useSessionChat";
import {
  type Agent,
  buildSubagents,
  busySubagentConversations,
  isDismissible,
} from "@/features/chat/model/agents";
import { plural } from "@/shared/lib/utils";

import { AgentCard } from "../sidebar/agents/AgentCard";
import { ComposerPill } from "./ComposerPill";

interface SessionAgentsPillProps {
  sessionId: string;
  /** The agent whose thread is in view, highlighted in the list. */
  selectedId?: string;
  onOpenAgent: (agent: Agent) => void;
  /** A finished agent was dismissed, e.g. to close its tab. */
  onRemoved?: (agent: Agent) => void;
}

/**
 * The pill above the chat box listing the sub-agents spawned in the session and
 * their live status, read from the session's shared chat state. Finished
 * agents stay listed until dismissed; choosing one opens its thread.
 */
export function SessionAgentsPill({
  sessionId,
  selectedId,
  onOpenAgent,
  onRemoved,
}: SessionAgentsPillProps) {
  const { subagents, isConversationBusy, abort, dismissSubagent } =
    useSessionChat(sessionId);
  if (subagents.length === 0) return null;

  const agents = buildSubagents(subagents);
  const busyConversations = busySubagentConversations(
    subagents,
    isConversationBusy,
  );
  const finished = agents.filter(isDismissible);
  const working = busyConversations.size;

  const dismiss = (agent: Agent) => {
    dismissSubagent(agent.id);
    onRemoved?.(agent);
  };

  return (
    <ComposerPill
      icon="Bot"
      label={
        working > 0
          ? `${plural(agents.length, "agent")} · ${working} working`
          : plural(agents.length, "agent")
      }
      heading="Spawned agents"
      clearLabel="Clear finished"
      onClear={
        finished.length > 0 ? () => finished.forEach(dismiss) : undefined
      }
    >
      {(close) => (
        <BlockStack as="ul" gap="1">
          {agents.map((agent) => {
            const busyConversationId = busyConversations.get(agent.id);
            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                sessionId={sessionId}
                selected={agent.id === selectedId}
                onOpen={() => {
                  close();
                  onOpenAgent(agent);
                }}
                onStop={
                  busyConversationId
                    ? () => abort(busyConversationId)
                    : undefined
                }
                onRemove={
                  isDismissible(agent) ? () => dismiss(agent) : undefined
                }
              />
            );
          })}
        </BlockStack>
      )}
    </ComposerPill>
  );
}
