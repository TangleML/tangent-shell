import { PRIME_AGENT_ID } from "../pi/types.ts";
import type {
  Participant,
  ParticipantStore,
} from "../store/participantStore.ts";
import type { SessionStore } from "../store/sessionStore.ts";

/** The orchestrator's id and the Conversation a message addressed to it lands in. */
export interface OrchestratorIdentity {
  orchestratorId: string;
  homeConversationId: string;
}

/**
 * The orchestrator's identity in one roster read: the id of the Participant
 * holding the `orchestrator` capability and its home Conversation. Reading both
 * from one `listAgents` is what stops the id and its home disagreeing — the
 * split that let a role-derived `orchestratorIdFor` and the stored-caps registry
 * drift after a revoke. Falls back to `PRIME_AGENT_ID` when a session has no
 * resolved orchestrator, so a caller addressing "Prime" still reaches the
 * conversation it always did.
 */
export async function orchestratorIdentity(
  sessions: Pick<SessionStore, "listAgents">,
  sessionId: string,
): Promise<OrchestratorIdentity> {
  const agents = await sessions.listAgents(sessionId);
  const holder = agents.find((agent) =>
    agent.capabilities.includes("orchestrator"),
  );
  if (!holder) {
    return {
      orchestratorId: PRIME_AGENT_ID,
      homeConversationId: PRIME_AGENT_ID,
    };
  }
  return {
    orchestratorId: holder.id,
    homeConversationId: holder.homeConversationId ?? holder.id,
  };
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
 * lands. A thin projection of {@link orchestratorIdentity} kept for the call
 * sites that need only the home; new code wanting both should read the identity
 * once rather than resolve the orchestrator twice.
 */
export async function orchestratorConversationFor(
  sessions: Pick<SessionStore, "listAgents">,
  sessionId: string,
): Promise<string> {
  return (await orchestratorIdentity(sessions, sessionId)).homeConversationId;
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

  constructor(sessions: SessionStore, store: ParticipantStore) {
    this.sessions = sessions;
    this.store = store;
  }

  /**
   * Every Participant in a session, read straight from the store. No cache:
   * since C.2 made `participants` the roster's only store, a roster write
   * (spawn, rename) goes through the store too, so a cache the writes did not
   * invalidate could only ever go stale.
   */
  async listForSession(sessionId: string): Promise<Participant[]> {
    return this.store.listForSession(sessionId);
  }

  /** One Participant by id, or nothing when the session holds no such row. */
  async get(sessionId: string, id: string): Promise<Participant | undefined> {
    return this.store.get(sessionId, id);
  }

  /**
   * The id of the Participant holding the `orchestrator` capability, resolved
   * through {@link orchestratorIdentity} so it is the same fact — from the same
   * read — everywhere. Falls back to `PRIME_AGENT_ID` when a session has no
   * resolved orchestrator yet.
   */
  async orchestratorId(sessionId: string): Promise<string> {
    return (await orchestratorIdentity(this.sessions, sessionId))
      .orchestratorId;
  }

  /**
   * The orchestrator's home Conversation — where a Message addressed to it
   * lands, distinct from its participant id since 2.4. This is where an
   * Automation's Membership belongs, not the participant id.
   */
  async orchestratorConversationId(sessionId: string): Promise<string> {
    return (await orchestratorIdentity(this.sessions, sessionId))
      .homeConversationId;
  }

  /**
   * The participant that owns a Conversation as its home thread — for cancel and
   * close, which act on the participant, not the Conversation id.
   */
  async ownerOf(sessionId: string, conversationId: string): Promise<string> {
    return participantForConversation(this.sessions, sessionId, conversationId);
  }
}
