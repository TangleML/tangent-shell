import {
  type AgentRole,
  capabilitiesForRole,
  type Capability,
  type ConnectorDescriptor,
  type ParticipantKind,
  type Presence,
  type SubagentStatus,
} from "@tangent/shared/contracts.ts";

import type { SessionAgent } from "./sessionStore.ts";

/**
 * The agent-only facts that used to be columns on `session_agents` and are now a
 * per-kind payload on a `Participant` — the shape that stops the roster table
 * being agent-shaped. Present only when `kind` is `"agent"`.
 */
export interface AgentPayload {
  role: AgentRole;
  model?: string;
  thinkingDepth?: string;
  template?: string;
  tools?: string[];
  systemPrompt?: string;
  autoRelayToPrime?: boolean;
  purpose?: string;
  status: SubagentStatus;
}

/**
 * A session-scoped actor identity: the unification of today's `ChatAuthor` and
 * `SubagentInfo`. `kind` describes role only; authority rides on `capabilities`
 * (Prime holds `orchestrator`), not on a reserved id. `connector` is the same
 * descriptor a roster row carries; `agent` holds the agent-only payload.
 */
export interface Participant {
  id: string;
  sessionId: string;
  kind: ParticipantKind;
  displayName: string;
  capabilities: Capability[];
  presence: Presence;
  connector: ConnectorDescriptor;
  agent?: AgentPayload;
  /**
   * Set once the Participant has been revoked from the session. The row is kept
   * so its transcript attributions still resolve; `undefined` means active.
   */
  revokedAt?: string;
  createdAt: string;
}

/** Folds a roster row's agent-only facts into an {@link AgentPayload}. */
function agentPayload(agent: SessionAgent): AgentPayload {
  return {
    role: agent.role,
    model: agent.model,
    thinkingDepth: agent.thinkingDepth,
    template: agent.template,
    tools: agent.tools,
    systemPrompt: agent.systemPrompt,
    autoRelayToPrime: agent.autoRelayToPrime,
    purpose: agent.purpose,
    status: agent.status,
  };
}

/**
 * Builds the {@link Participant} a roster agent stands for. Since C.2 dropped
 * `session_agents`, this is how {@link
 * import("./sessionStore.ts").SessionStore.recordAgent} shapes the row it writes
 * into `participants`, the roster's only store.
 */
export function participantFromAgent(agent: SessionAgent): Participant {
  return {
    id: agent.id,
    sessionId: agent.sessionId,
    kind: "agent",
    displayName: agent.name,
    capabilities: agent.capabilities,
    // Presence follows the roster's lifecycle: a detached tab (1.4) is a
    // participant whose far end is gone, the same question a human's presence
    // asks. Every other status is a runtime that is reachable.
    presence: agent.status === "detached" ? "detached" : "connected",
    connector: agent.connector,
    agent: agentPayload(agent),
    createdAt: agent.createdAt,
  };
}

/**
 * Recovers the {@link SessionAgent} an agent Participant stands for — the
 * inverse of {@link participantFromAgent}. Since C.2 dropped `session_agents`,
 * `participants` is the roster's only store, so this is the one place a
 * participant row becomes a roster agent for {@link
 * import("./sessionStore.ts").SessionStore.listAgents}. Capabilities are
 * re-derived from the role rather than trusting the stored column, matching
 * every prior roster read.
 */
export function sessionAgentFromParticipant(
  participant: Participant,
  homeConversationId: string,
): SessionAgent {
  const payload: AgentPayload = participant.agent ?? {
    role: "subagent",
    status: "active",
  };
  return {
    id: participant.id,
    sessionId: participant.sessionId,
    role: payload.role,
    name: participant.displayName,
    capabilities: capabilitiesForRole(payload.role),
    purpose: payload.purpose,
    status: payload.status,
    model: payload.model,
    thinkingDepth: payload.thinkingDepth,
    template: payload.template,
    tools: payload.tools,
    systemPrompt: payload.systemPrompt,
    autoRelayToPrime: payload.autoRelayToPrime,
    connector: participant.connector,
    homeConversationId,
    createdAt: participant.createdAt,
  };
}

/**
 * Durable home of the session's {@link Participant}s. Kept apart from
 * {@link import("./sessionStore.ts").SessionStore} for the same reason
 * {@link import("./membershipStore.ts").MembershipStore} is: it is read by one
 * registry, not by the REST routes. Since C.2 dropped `session_agents`, this is
 * the roster's only store: agents land here through the session store, humans
 * and automations through the participant service.
 */
export interface ParticipantStore {
  /** Every participant in a session, oldest first. */
  listForSession(sessionId: string): Promise<Participant[]>;
  /** One participant by id, or nothing when the row does not exist yet. */
  get(sessionId: string, id: string): Promise<Participant | undefined>;
  /** Upserts by `(sessionId, id)`. */
  put(participant: Participant): Promise<void>;
  /** Moves a participant to a new {@link Presence}. A no-op if the row is gone. */
  updatePresence(
    sessionId: string,
    id: string,
    presence: Presence,
  ): Promise<void>;
  /**
   * Marks a participant revoked (stamps `revokedAt`, drops its capabilities) so
   * it no longer acts, without deleting the row — its transcript attributions
   * must still resolve. A no-op if the row is gone.
   */
  revoke(sessionId: string, id: string): Promise<void>;
}
