import { useAgentStatus } from "@/features/chat/hooks/useAgentStatus";
import { type Agent, agentStatusVisual } from "@/features/chat/model/agents";
import { ListItem, type ListItemAction } from "@/shared/ui/patterns/list-item";

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

/**
 * One session agent (Prime or a sub-agent) in the sidebar. The icon conveys the
 * agent kind, the flair its live status, and the subtitle says it in words.
 * Clicking it opens (or focuses) the agent's thread tab.
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
      flair={agentStatusVisual(status, busy)}
      tone={status === "error" ? "critical" : undefined}
      selected={selected}
      onOpen={onOpen}
      actions={actions}
    />
  );
}
