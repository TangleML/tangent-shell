import type { Agent } from "@/features/chat/model/agents";
import { Box } from "@/shared/ui/box";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { Toolbar } from "@/shared/ui/patterns/toolbar";
import { Text } from "@/shared/ui/typography";

import { AgentCard } from "./AgentCard";

interface AgentListProps {
  agents: Agent[];
  /** Session the agents belong to; keys each agent's shared live status. */
  sessionId: string;
  /** The active tab's id, so the matching card reads as selected. */
  selectedId: string | null;
  /** Opens (or focuses) an agent's in-app tab. */
  onOpen: (agent: Agent) => void;
  /** Removes a (killed) sub-agent from the list and closes its tab. */
  onRemove?: (agent: Agent) => void;
}

/**
 * Sidebar list of the session's agents — Prime first, then the live sub-agent
 * roster — each rendered as a uniform {@link AgentCard}. Clicking a card opens
 * (or focuses) that agent's thread in its own in-app tab.
 */
export function AgentList({
  agents,
  sessionId,
  selectedId,
  onOpen,
  onRemove,
}: AgentListProps) {
  return (
    <BlockStack gap="0" align="stretch">
      <Toolbar chrome="light" gap="2" align="space-between">
        <InlineStack gap="2" blockAlign="center" wrap="nowrap">
          <Icon name="Bot" size="md" tone="subdued" />
          <Text size="xs" weight="medium">
            Agents
          </Text>
        </InlineStack>
        <Text size="xs" tone="subdued">
          {agents.length}
        </Text>
      </Toolbar>
      <Box padding="sm">
        <BlockStack as="ul" gap="1">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              sessionId={sessionId}
              selected={selectedId === agent.id}
              onOpen={() => onOpen(agent)}
              onRemove={
                agent.kind === "subagent" && agent.status === "killed"
                  ? () => onRemove?.(agent)
                  : undefined
              }
            />
          ))}
        </BlockStack>
      </Box>
    </BlockStack>
  );
}
