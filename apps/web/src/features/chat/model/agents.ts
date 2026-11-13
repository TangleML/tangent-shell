import {
  isTerminalStatus,
  PI_AGENT,
  type SubagentInfo,
  type SubagentStatus,
} from "@tangent/shared/contracts";
import type { IconName } from "@tangent/ui-primitives/icon";

/**
 * A session agent surfaced in the sidebar as a card and openable in its own
 * in-app tab. Prime is always present and leads the list; sub-agents follow,
 * driven by the live roster. The leading icon conveys the kind; the trailing
 * status indicator reflects the agent's lifecycle.
 */
export interface Agent {
  /**
   * Stable id; the agent's `ChatAuthor.id`. No longer the conversation id — a
   * thread is resolved to its Conversation through the roster (`conversationId`)
   * / `conversationForAgent`, decoupled since 2.4.
   */
  id: string;
  name: string;
  kind: "prime" | "subagent";
  status: SubagentStatus;
}

/**
 * Projects the live sub-agent roster into a uniform list of {@link Agent}s with
 * Prime first. Prime has no lifecycle status of its own, so it reads as
 * `active`; busy state is derived at render via `isConversationBusy`.
 */
export function buildAgents(subagents: SubagentInfo[]): Agent[] {
  const prime: Agent = {
    id: PI_AGENT.id,
    name: PI_AGENT.name,
    kind: "prime",
    status: "active",
  };

  return [prime, ...buildSubagents(subagents)];
}

/** The sub-agents Prime has spawned, as {@link Agent}s, without Prime. */
export function buildSubagents(subagents: SubagentInfo[]): Agent[] {
  return sortSubagents(subagents).map((subagent) => ({
    id: subagent.id,
    name: subagent.name,
    kind: "subagent",
    status: subagent.status,
  }));
}

/** How an agent's live status shows: a dot while it can work, else an icon. */
export type AgentStatusVisual =
  | { kind: "dot"; variant: "busy" | "active" }
  | { kind: "icon"; icon: IconName; tone?: "critical" };

/** One mapping for every place an agent's status shows, so they agree. */
export function agentStatusVisual(
  status: SubagentStatus,
  busy: boolean,
): AgentStatusVisual {
  if (busy) return { kind: "dot", variant: "busy" };
  switch (status) {
    case "active":
      return { kind: "dot", variant: "active" };
    case "detached":
      return { kind: "icon", icon: "Unplug" };
    case "completed":
      return { kind: "icon", icon: "Check" };
    case "killed":
      return { kind: "icon", icon: "Ban" };
    case "error":
      return { kind: "icon", icon: "TriangleAlert", tone: "critical" };
  }
}

// The server ignores a dismissal for a sub-agent still running.
export function isDismissible(agent: Agent): boolean {
  return agent.kind === "subagent" && isTerminalStatus(agent.status);
}

// Active sub-agents float to the top so the live entries are easy to scan;
// ended ones (completed/killed/error) settle after, in their most recent order.
export function sortSubagents(subagents: SubagentInfo[]): SubagentInfo[] {
  return [...subagents].sort((a, b) => {
    const aActive = a.status === "active" ? 0 : 1;
    const bActive = b.status === "active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
