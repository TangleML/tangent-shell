import { PRIME_AGENT_ID } from "../pi/types.ts";
import type {
  Participant,
  ParticipantStore,
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
 * The Conversation an agent posts into — the mapping that lets a Conversation id
 * stop naming an agent. Falls back to the agent's own id for a legacy agent the
 * `conversations` table never mapped, whose transcript is keyed that way.
 */
export async function homeConversationFor(
  sessions: Pick<SessionStore, "listAgents">,
  sessionId: string,
  agentId: string,
): Promise<string> {
  const agents = await sessions.listAgents(sessionId);
  const agent = agents.find((candidate) => candidate.id === agentId);
  return agent?.homeConversationId ?? agentId;
}

/**
 * The participant that owns a Conversation as its home thread — the reverse of
 * {@link homeConversationFor}, for cancel/abort and delivery framing. Falls back
 * to the Conversation id itself for a legacy thread the mapping never covered.
 */
export async function participantForConversation(
  sessions: Pick<SessionStore, "listAgents">,
  sessionId: string,
  conversationId: string,
): Promise<string> {
  const agents = await sessions.listAgents(sessionId);
  const owner = agents.find(
    (candidate) => candidate.homeConversationId === conversationId,
  );
  return owner?.id ?? conversationId;
}

/**
 * The orchestrator's home Conversation — where a message addressed to "Prime"
 * lands. The successor to using the orchestrator's participant id as a
 * conversation id, now that the two are distinct.
 */
export async function orchestratorConversationFor(
  sessions: Pick<SessionStore, "listAgents">,
  sessionId: string,
): Promise<string> {
  const agents = await sessions.listAgents(sessionId);
  const holder = agents.find((agent) =>
    agent.capabilities.includes("orchestrator"),
  );
  return holder?.homeConversationId ?? holder?.id ?? PRIME_AGENT_ID;
}

/**
 * The session's Participants, read from the {@link ParticipantStore}. Since C.2
 * dropped `session_agents`, `participants` is the roster's only store: an agent
 * is written there by {@link
 * import("../store/sessionStore.ts").SessionStore.recordAgent} and read back
 * here alongside the humans and automations {@link
 * import("./participantService.ts").ParticipantService} invites, with no roster
 * overlay to reconcile.
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

  /**
   * The participant that owns a Conversation as its home thread — for cancel and
   * close, which act on the participant, not the Conversation id.
   */
  async ownerOf(sessionId: string, conversationId: string): Promise<string> {
    return participantForConversation(this.sessions, sessionId, conversationId);
  }

  /** Loads a session's participants once from the store. */
  private async load(sessionId: string): Promise<Map<string, Participant>> {
    const cached = this.cache.get(sessionId);
    if (cached) return cached;

    const byId = new Map<string, Participant>();
    for (const stored of await this.store.listForSession(sessionId)) {
      byId.set(stored.id, stored);
    }

    this.cache.set(sessionId, byId);
    return byId;
  }
}
