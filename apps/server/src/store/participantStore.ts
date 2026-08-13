import type {
  AgentRole,
  Capability,
  ConnectorDescriptor,
  ParticipantKind,
  Presence,
  SubagentHost,
  SubagentStatus,
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
  host?: SubagentHost;
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
    host: agent.host,
    purpose: agent.purpose,
    status: agent.status,
  };
}

/**
 * Builds the {@link Participant} a roster row stands for. `session_agents` is
 * the write authority for this PR, so this is the one place a roster row becomes
 * a participant — used both by the backfill's read-through derivation and by the
 * dual-write on {@link import("./sessionStore.ts").SessionStore.recordAgent}.
 */
export function participantFromAgent(agent: SessionAgent): Participant {
  return {
    id: agent.id,
    sessionId: agent.sessionId,
    kind: "agent",
    displayName: agent.name,
    capabilities: agent.capabilities,
    presence: "connected",
    connector: agent.connector,
    agent: agentPayload(agent),
    createdAt: agent.createdAt,
  };
}

/**
 * Durable home of the session's {@link Participant}s. Kept apart from
 * {@link import("./sessionStore.ts").SessionStore} for the same reason
 * {@link import("./membershipStore.ts").MembershipStore} is: it is read by one
 * registry, not by the REST routes. `session_agents` stays the write authority
 * for this PR, so these rows are backfilled from it and kept in sync on record;
 * a session the backfill never touched is derived read-through.
 */
export interface ParticipantStore {
  /** Every participant in a session, oldest first. */
  listForSession(sessionId: string): Promise<Participant[]>;
  /** One participant by id, or nothing when the row does not exist yet. */
  get(sessionId: string, id: string): Promise<Participant | undefined>;
  /** Upserts by `(sessionId, id)`. */
  put(participant: Participant): Promise<void>;
}
