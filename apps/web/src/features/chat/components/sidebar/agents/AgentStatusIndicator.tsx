import { Icon } from "@tangent/ui-primitives/icon";

import { useAgentStatus } from "@/features/chat/hooks/useAgentStatus";
import { agentStatusVisual } from "@/features/chat/model/agents";
import { StatusDot } from "@/shared/ui/patterns/status-dot";

interface AgentStatusProps {
  /** Session the agent belongs to; with `agentId` keys the shared live status. */
  sessionId: string;
  /** The agent's id (`"prime"` or a sub-agent id). */
  agentId: string;
}

/**
 * Status-tinted indicator mirroring an agent's lifecycle. A busy run pulses; an
 * idle agent shows its detached/terminal/active state. Reads its live status from
 * the shared cache, so the sidebar agent card and the opened agent tab trigger
 * always agree and the state survives a page reload.
 */
export function AgentStatusIndicator({ sessionId, agentId }: AgentStatusProps) {
  const { status, busy } = useAgentStatus(sessionId, agentId);
  const visual = agentStatusVisual(status, busy);

  if (visual.kind === "dot") return <StatusDot variant={visual.variant} />;
  return <Icon name={visual.icon} size="xs" tone={visual.tone ?? "subdued"} />;
}
