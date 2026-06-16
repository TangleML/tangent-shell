import type { SubagentStatus } from "@tangent/shared/contracts";

import { Icon } from "@/shared/ui/icon";

import { StatusDot } from "./StatusDot";

interface AgentStatusIndicatorProps {
  status: SubagentStatus;
  /** Whether this agent's run is in flight. */
  busy: boolean;
}

/**
 * Status-tinted indicator mirroring an agent's lifecycle. A busy run pulses; an
 * idle agent shows its terminal/active state. Shared by the sidebar agent card
 * and the opened agent tab trigger.
 */
export function AgentStatusIndicator({
  status,
  busy,
}: AgentStatusIndicatorProps) {
  if (busy) {
    return <StatusDot variant="busy" />;
  }

  switch (status) {
    case "active":
      return <StatusDot variant="active" />;
    case "completed":
      return <Icon name="Check" size="xs" tone="subdued" />;
    case "killed":
      return <Icon name="Ban" size="xs" tone="subdued" />;
    case "error":
      return <Icon name="TriangleAlert" size="xs" tone="critical" />;
  }
}
