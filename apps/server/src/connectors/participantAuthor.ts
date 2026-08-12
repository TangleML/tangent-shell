import type { ChatAuthor } from "@tangent/shared/contracts.ts";

import type { ConnectorRegistry } from "./connectorRegistry.ts";

/**
 * The chat author of a live sub-agent, read from the roster it appears in.
 * Nothing may assert a participant's identity on its behalf, so the name a
 * Message is attributed to comes from the connector that holds it.
 */
export function subagentAuthor(
  connectors: ConnectorRegistry,
  sessionId: string,
  participantId: string,
): ChatAuthor | undefined {
  const subagent = connectors
    .list(sessionId)
    .find((candidate) => candidate.id === participantId);
  if (!subagent) return undefined;
  return {
    id: subagent.id,
    kind: "agent",
    name: subagent.name,
    agentRole: "subagent",
  };
}
