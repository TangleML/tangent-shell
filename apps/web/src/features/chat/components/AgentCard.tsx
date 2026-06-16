import type { Agent } from "@/features/chat/model/agents";
import { Box } from "@/shared/ui/box";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Truncating } from "@/shared/ui/patterns/truncating";
import { Text } from "@/shared/ui/typography";

import { AgentStatusIndicator } from "./AgentStatusIndicator";

interface AgentCardProps {
  agent: Agent;
  /** Whether this agent's tab is the active one. */
  selected: boolean;
  /** Whether this agent's run is in flight. */
  busy: boolean;
  /** Opens (or focuses) the agent's in-app tab. */
  onOpen: () => void;
}

/**
 * A condensed card representing one session agent (Prime or a sub-agent),
 * styled like {@link AssetCard}. The leading icon conveys the agent kind; the
 * trailing indicator reflects its live status. Clicking the card opens (or
 * focuses) the agent's thread tab.
 */
export function AgentCard({ agent, selected, busy, onOpen }: AgentCardProps) {
  return (
    <ListRow
      as="li"
      density="cozy"
      gap="2"
      hoverable
      selected={selected}
      onClick={onOpen}
      prefix={
        <Box background="success-subtle" blockSize="full" paddingInline="sm">
          <InlineStack fill blockAlign="center" align="center">
            <Icon
              name={agent.kind === "prime" ? "Sparkles" : "Bot"}
              size="lg"
              tone="subdued"
            />
          </InlineStack>
        </Box>
      }
    >
      <BlockStack gap="0" align="stretch">
        <InlineStack
          gap="2"
          wrap="nowrap"
          blockAlign="center"
          align="space-between"
        >
          <Truncating>
            <Text size="sm" weight="medium" truncate title={agent.name}>
              {agent.name}
            </Text>
          </Truncating>
          <AgentStatusIndicator status={agent.status} busy={busy} />
        </InlineStack>
        <Text size="xs" tone="subdued" truncate>
          {agent.status}
        </Text>
      </BlockStack>
    </ListRow>
  );
}
