import { PI_AGENT } from "@shared/contracts";
import type { ReactNode } from "react";

import type { SubagentInfo, SubagentStatus } from "@/features/chat/model/types";
import { Box } from "@/shared/ui/box";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";
import { Toolbar } from "@/shared/ui/patterns/toolbar";
import { Truncating } from "@/shared/ui/patterns/truncating";
import { Spinner } from "@/shared/ui/spinner";
import { Text } from "@/shared/ui/typography";

import { SidebarColumn } from "./SidebarColumn";

interface SubagentListProps {
  subagents: SubagentInfo[];
  /** Currently open thread: `null` is Prime's main thread, else a sub-agent id. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Whether a given conversation has a reply streaming right now. */
  isConversationBusy: (conversationId: string) => boolean;
}

const STATUS_LABEL: Record<SubagentStatus, string> = {
  active: "Active",
  completed: "Completed",
  killed: "Killed",
  error: "Error",
};

function StatusIcon({ status }: { status: SubagentStatus }) {
  switch (status) {
    case "active":
      return <Icon name="LoaderCircle" size="sm" tone="success" spin />;
    case "completed":
      return <Icon name="Check" size="sm" tone="subdued" />;
    case "killed":
      return <Icon name="Ban" size="sm" tone="subdued" />;
    case "error":
      return <Icon name="TriangleAlert" size="sm" tone="critical" />;
  }
}

interface RosterRowProps {
  selected: boolean;
  busy: boolean;
  icon: ReactNode;
  title: string;
  primary: string;
  secondary: string;
  /** Emphasize the primary label (active agents / Prime). */
  emphasized: boolean;
  onClick: () => void;
}

function RosterRow({
  selected,
  busy,
  icon,
  title,
  primary,
  secondary,
  emphasized,
  onClick,
}: RosterRowProps) {
  return (
    <ListRow
      as="li"
      density="cozy"
      gap="2"
      hoverable
      selected={selected}
      onClick={onClick}
    >
      {icon}
      <Truncating>
        <BlockStack gap="0">
          <Text
            size="sm"
            weight={emphasized ? "medium" : "regular"}
            tone={emphasized ? "inherit" : "subdued"}
            truncate
            title={title}
          >
            {primary}
          </Text>
          <Text size="xs" tone="subdued" truncate>
            {secondary}
          </Text>
        </BlockStack>
      </Truncating>
      {busy ? <Spinner size={12} /> : null}
    </ListRow>
  );
}

// Active sub-agents float to the top so the live roster is easy to scan; ended
// ones (completed/killed/error) settle below in their most recent order.
function sortSubagents(subagents: SubagentInfo[]): SubagentInfo[] {
  return [...subagents].sort((a, b) => {
    const aActive = a.status === "active" ? 0 : 1;
    const bActive = b.status === "active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function SubagentList({
  subagents,
  selectedId,
  onSelect,
  isConversationBusy,
}: SubagentListProps) {
  const activeCount = subagents.filter((s) => s.status === "active").length;

  return (
    <SidebarColumn>
      <Toolbar chrome="light" gap="2" align="space-between">
        <InlineStack gap="2" blockAlign="center" wrap="nowrap">
          <Icon name="Bot" size="md" tone="subdued" />
          <Text size="xs" weight="medium">
            Agents
          </Text>
        </InlineStack>
        {activeCount > 0 ? (
          <Text size="xs" tone="subdued">
            {activeCount} active
          </Text>
        ) : null}
      </Toolbar>
      <ScrollRegion axis="y">
        <Box padding="sm">
          <BlockStack as="ul" gap="1">
            {/* Prime's main thread is always present and selectable. */}
            <RosterRow
              selected={selectedId === null}
              busy={isConversationBusy(PI_AGENT.id)}
              icon={<Icon name="Crown" size="sm" tone="warning" />}
              title={PI_AGENT.name}
              primary={PI_AGENT.name}
              secondary="Main thread"
              emphasized
              onClick={() => onSelect(null)}
            />
            {subagents.length === 0 ? (
              <li>
                <Box paddingInline="sm" paddingBlock="xs">
                  <Text size="xs" tone="subdued">
                    No sub-agents yet. Prime will spawn them as needed.
                  </Text>
                </Box>
              </li>
            ) : (
              sortSubagents(subagents).map((subagent) => {
                const isActive = subagent.status === "active";
                return (
                  <RosterRow
                    key={subagent.id}
                    selected={selectedId === subagent.id}
                    busy={isConversationBusy(subagent.id)}
                    icon={<StatusIcon status={subagent.status} />}
                    title={subagent.name}
                    primary={subagent.name}
                    secondary={`${STATUS_LABEL[subagent.status]}${
                      subagent.template ? ` · ${subagent.template}` : ""
                    }`}
                    emphasized={isActive}
                    onClick={() => onSelect(subagent.id)}
                  />
                );
              })
            )}
          </BlockStack>
        </Box>
      </ScrollRegion>
    </SidebarColumn>
  );
}
