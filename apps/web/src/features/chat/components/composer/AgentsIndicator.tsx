import { Box } from "@tangent/ui-primitives/box";
import { Button } from "@tangent/ui-primitives/button";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@tangent/ui-primitives/popover";
import { Text } from "@tangent/ui-primitives/typography";
import { useId, useState } from "react";

import { type Agent, isDismissible } from "@/features/chat/model/agents";

import { AgentCard } from "../sidebar/agents/AgentCard";

interface BusySubagent {
  id: string;
  /** The sub-agent's Conversation, which `onAbort` cancels the run in. */
  conversationId: string;
}

interface AgentsIndicatorProps {
  sessionId: string;
  /** The sub-agents spawned in this session, without Prime. */
  agents: Agent[];
  busySubagents: BusySubagent[];
  /** The agent whose thread is in view, highlighted in the list. */
  selectedId?: string;
  onOpenAgent: (agent: Agent) => void;
  onRemoveAgent: (agent: Agent) => void;
  onAbort: (conversationId: string) => void;
}

function pillLabel(count: number, busyCount: number): string {
  const agents = count === 1 ? "1 agent" : `${count} agents`;
  return busyCount > 0 ? `${agents} · ${busyCount} working` : agents;
}

/**
 * Composer-anchored pill listing the session's spawned sub-agents and their
 * live status. Finished agents stay listed until dismissed; choosing one opens
 * its thread.
 */
export function AgentsIndicator({
  sessionId,
  agents,
  busySubagents,
  selectedId,
  onOpenAgent,
  onRemoveAgent,
  onAbort,
}: AgentsIndicatorProps) {
  const [open, setOpen] = useState(false);
  const headingId = useId();

  if (agents.length === 0) {
    // Emptying the list unmounts the popover without an onOpenChange, so reset
    // here or it reopens on its own when the next agent spawns.
    if (open) setOpen(false);
    return null;
  }

  const busyConversations = new Map(
    busySubagents.map((agent) => [agent.id, agent.conversationId]),
  );
  const finished = agents.filter(isDismissible);

  const clearFinished = () => {
    for (const agent of finished) onRemoveAgent(agent);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="xs">
          <Icon name="Bot" size="xs" />
          {pillLabel(agents.length, busyConversations.size)}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top">
        <BlockStack gap="0.5" align="stretch">
          <Box paddingInline="sm" paddingBlockStart="xs">
            <InlineStack align="space-between" gap="2" wrap="nowrap">
              <Text id={headingId} size="xs" weight="medium" tone="subdued">
                Spawned agents
              </Text>
              {finished.length > 0 && (
                <Button variant="ghost" size="xs" onClick={clearFinished}>
                  Clear finished
                </Button>
              )}
            </InlineStack>
          </Box>
          <Box maxBlockSize="xl" overflow="scroll-y">
            <BlockStack as="ul" gap="1" aria-labelledby={headingId}>
              {agents.map((agent) => {
                const busyConversationId = busyConversations.get(agent.id);
                return (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    sessionId={sessionId}
                    selected={agent.id === selectedId}
                    onOpen={() => {
                      setOpen(false);
                      onOpenAgent(agent);
                    }}
                    onStop={
                      busyConversationId
                        ? () => onAbort(busyConversationId)
                        : undefined
                    }
                    onRemove={
                      isDismissible(agent)
                        ? () => onRemoveAgent(agent)
                        : undefined
                    }
                  />
                );
              })}
            </BlockStack>
          </Box>
        </BlockStack>
      </PopoverContent>
    </Popover>
  );
}
