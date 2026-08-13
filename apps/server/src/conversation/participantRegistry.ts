import { PRIME_AGENT_ID } from "../pi/types.ts";
import {
  type Participant,
  participantFromAgent,
  type ParticipantStore,
} from "../store/participantStore.ts";
import type { SessionStore } from "../store/sessionStore.ts";

/**
 * The id of the Participant holding the `orchestrator` capability — the
 * successor to the reserved `PRIME_AGENT_ID`. Resolves from the roster, the
 * write authority for this PR, so it is the same fact everywhere. Falls back to
 * `PRIME_AGENT_ID` when a session has no resolved orchestrator, so a caller
 * addressing "Prime" still reaches the conversation it always did.
 */
export async function orchestratorIdFor(
  sessions: Pick<SessionStore, "listAgents">,
  sessionId: string,
): Promise<string> {
  const agents = await sessions.listAgents(sessionId);
  const holder = agents.find((agent) =>
    agent.capabilities.includes("orchestrator"),
  );
  return holder?.id ?? PRIME_AGENT_ID;
}

/**
 * The session's Participants. Reads through to a {@link ParticipantStore}, but
 * the roster (`session_agents`) stays the write authority for this PR: for every
 * agent the current roster row wins, so an agent's participant view is never
 * stale, and a row the migration backfill never materialized is persisted on
 * first read — the same derive-and-persist shape
 * {@link import("./membershipRegistry.ts").MembershipRegistry} uses. Stored
 * participants with no roster row (future humans/automations) are returned as
 * they stand.
 */
export class ParticipantRegistry {
  private readonly sessions: SessionStore;
  private readonly store: ParticipantStore;
  /** sessionId -> participantId -> participant. */
  private readonly cache = new Map<string, Map<string, Participant>>();

  constructor(sessions: SessionStore, store: ParticipantStore) {
    this.sessions = sessions;
    this.store = store;
  }

  /** Every Participant in a session, roster rows reconciled and persisted. */
  async listForSession(sessionId: string): Promise<Participant[]> {
    const byId = await this.load(sessionId);
    return [...byId.values()];
  }

  /**
   * Drops a session's cached participants so the next read reloads from the
   * store. Called after a write the registry did not make itself — an
   * invitation, a revocation, a presence transition — so a human added out of
   * band is not hidden behind a stale cache.
   */
  invalidate(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  /** One Participant by id, or nothing when neither a row nor an agent exists. */
  async get(sessionId: string, id: string): Promise<Participant | undefined> {
    const byId = await this.load(sessionId);
    return byId.get(id);
  }

  /**
   * The id of the Participant holding the `orchestrator` capability — the
   * successor to the reserved `PRIME_AGENT_ID`. Falls back to that id when a
   * session has no resolved orchestrator yet, so a caller addressing "Prime"
   * still reaches the same conversation it always did.
   */
  async orchestratorId(sessionId: string): Promise<string> {
    const participants = await this.listForSession(sessionId);
    const holder = participants.find((participant) =>
      participant.capabilities.includes("orchestrator"),
    );
    return holder?.id ?? PRIME_AGENT_ID;
  }

  /** Loads a session's participants once, reconciling them against the roster. */
  private async load(sessionId: string): Promise<Map<string, Participant>> {
    const cached = this.cache.get(sessionId);
    if (cached) return cached;

    const byId = new Map<string, Participant>();
    for (const stored of await this.store.listForSession(sessionId)) {
      byId.set(stored.id, stored);
    }

    for (const agent of await this.sessions.listAgents(sessionId)) {
      const derived = participantFromAgent(agent);
      const known = byId.get(agent.id);
      byId.set(agent.id, derived);
      // Persist a row the backfill never wrote; existing rows already hold the
      // stable facts (id, kind, capabilities) this PR reads.
      if (!known) await this.store.put(derived);
    }

    this.cache.set(sessionId, byId);
    return byId;
  }
}
