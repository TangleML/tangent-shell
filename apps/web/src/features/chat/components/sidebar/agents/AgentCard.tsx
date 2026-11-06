import type { SubagentStatus } from "@tangent/shared/contracts";

import { useAgentStatus } from "@/features/chat/hooks/useAgentStatus";
import type { Agent } from "@/features/chat/model/agents";
import {
  ListItem,
  type ListItemAction,
  type ListItemFlair,
} from "@/shared/ui/patterns/list-item";

interface AgentCardProps {
  agent: Agent;
  /** Session the agent belongs to; keys its shared live status. */
  sessionId: string;
  /** Whether this agent's tab is the active one. */
  selected?: boolean;
  /** Opens (or focuses) the agent's in-app tab. */
  onOpen: () => void;
  /** Stops the agent's current run; shown as a hover-revealed action. */
  onStop?: () => void;
  /**
   * Removes the agent from the list (e.g. dismissing a killed sub-agent).
   * When provided, a hover-revealed remove action is shown.
   */
  onRemove?: () => void;
}

// Keep in step with AgentStatusIndicator, which shows these states on the tab.
function statusFlair(
  status: SubagentStatus,
  busy: boolean,
  label: string,
): ListItemFlair {
  if (busy) return { kind: "dot", label, tone: "success", pulse: true };
  switch (status) {
    case "active":
      return { kind: "dot", label, tone: "success" };
    case "detached":
      return { kind: "icon", icon: "Unplug", label };
    case "completed":
      return { kind: "icon", icon: "Check", label };
    case "killed":
      return { kind: "icon", icon: "Ban", label };
    case "error":
      return { kind: "icon", icon: "TriangleAlert", label, tone: "critical" };
  }
}

/**
 * One session agent (Prime or a sub-agent) in the sidebar. The icon conveys the
 * agent kind and the flair its live status. Clicking it opens (or focuses) the
 * agent's thread tab.
 */
export function AgentCard({
  agent,
  sessionId,
  selected,
  onOpen,
  onStop,
  onRemove,
}: AgentCardProps) {
  const { status, busy, label } = useAgentStatus(sessionId, agent.id);

  const actions: ListItemAction[] = [];
  if (onStop) {
    actions.push({
      icon: "CircleStop",
      label: `Stop ${agent.name}`,
      tone: "critical",
      onClick: onStop,
    });
  }
  if (onRemove) {
    actions.push({
      icon: "Trash2",
      label: `Remove ${agent.name}`,
      tone: "critical",
      onClick: onRemove,
    });
  }

  return (
    <ListItem
      icon={agent.kind === "prime" ? "Crown" : "Bot"}
      title={agent.name}
      subtitle={label}
      flair={statusFlair(status, busy, label)}
      tone={status === "error" ? "critical" : undefined}
      selected={selected}
      onOpen={onOpen}
      actions={actions}
    />
  );
}
