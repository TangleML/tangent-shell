import type {
  ConnectorKind,
  ReactionSpec,
  TranscriptVisibility,
} from "@tangent/shared/contracts.ts";

import { PRIME_AGENT_ID } from "../pi/types.ts";
import type { Membership, MembershipStore } from "../store/membershipStore.ts";
import type { SessionAgent, SessionStore } from "../store/sessionStore.ts";
import { reactionSpec } from "./reaction.ts";

/** Whether a participant's transport can be delivered to at all. */
export type AcceptsDelivery = (kind: ConnectorKind) => boolean;

/**
 * What a participant reacts to in its own Conversation: a person talking to it,
 * or another participant addressing it.
 */
const ADDRESSABLE = reactionSpec("fromHumans", "mentionsMe");

/**
 * The orchestrator's reaction in a sub-agent's Conversation, and the successor
 * to `autoRelayToPrime: true`: the sub-agent's finalized output plus anything
 * that addresses Prime explicitly. Not `always` — a human message or a trigger
 * prompt landing in that thread never woke Prime, and should not start doing so.
 */
const ORCHESTRATOR = reactionSpec("atRunEnd", "mentionsMe");

/**
 * The successor to `autoRelayToPrime: false`: reachable only when the sub-agent
 * addresses Prime itself, which is what `message_prime` now does.
 */
const ON_REQUEST = reactionSpec("mentionsMe");

/** A member that has declared it does not act — a display-only external tab. */
const INERT = reactionSpec("never");

function membership(
  sessionId: string,
  participantId: string,
  conversationId: string,
  reaction: ReactionSpec,
  transcriptVisibility: TranscriptVisibility = "shared",
): Membership {
  return {
    sessionId,
    participantId,
    conversationId,
    reaction,
    ingress: "reaction",
    transcriptVisibility,
  };
}

/**
 * Who is in each Conversation and what each of them reacts to. Reads through to
 * a {@link MembershipStore}, deriving rows from the agent roster for
 * Conversations that have none — so a session whose migration backfill never ran
 * still resolves correctly, the same read-time fallback the connector columns
 * use.
 */
export class MembershipRegistry {
  private readonly sessions: SessionStore;
  private readonly store: MembershipStore;
  private readonly acceptsDelivery: AcceptsDelivery;
  /** sessionId -> conversationId -> memberships. */
  private readonly cache = new Map<string, Map<string, Membership[]>>();

  constructor(
    sessions: SessionStore,
    store: MembershipStore,
    acceptsDelivery: AcceptsDelivery,
  ) {
    this.sessions = sessions;
    this.store = store;
    this.acceptsDelivery = acceptsDelivery;
  }

  /**
   * The memberships of one Conversation. A sub-agent whose roster row has not
   * landed yet — the window between a spawn and its persisted row — is derived
   * provisionally: returned so its first task still reaches it, but neither
   * cached nor persisted, so the row's own facts win as soon as it exists.
   */
  async membersOf(
    sessionId: string,
    conversationId: string,
  ): Promise<Membership[]> {
    const byConversation = await this.load(sessionId);
    const known = byConversation.get(conversationId);
    if (known) return known;

    const agents = await this.sessions.listAgents(sessionId);
    const agent = agents.find((candidate) => candidate.id === conversationId);
    const derived = this.derive(sessionId, conversationId, agent);
    if (!agent && conversationId !== PRIME_AGENT_ID) return derived;

    byConversation.set(conversationId, derived);
    for (const row of derived) await this.store.put(row);
    return derived;
  }

  /** The session's memberships, indexed by conversation on first use. */
  private async load(sessionId: string): Promise<Map<string, Membership[]>> {
    const cached = this.cache.get(sessionId);
    if (cached) return cached;

    const byConversation = new Map<string, Membership[]>();
    for (const row of await this.store.listForSession(sessionId)) {
      const existing = byConversation.get(row.conversationId);
      if (existing) existing.push(row);
      else byConversation.set(row.conversationId, [row]);
    }
    this.cache.set(sessionId, byConversation);
    return byConversation;
  }

  /**
   * Builds a Conversation's memberships from the roster row and its connector.
   * Prime's own Conversation holds only Prime; a sub-agent's holds the sub-agent
   * and the orchestrator.
   */
  private derive(
    sessionId: string,
    conversationId: string,
    agent: SessionAgent | undefined,
  ): Membership[] {
    if (conversationId === PRIME_AGENT_ID) {
      return [
        membership(sessionId, PRIME_AGENT_ID, PRIME_AGENT_ID, ADDRESSABLE),
      ];
    }

    const relays = agent?.autoRelayToPrime ?? true;
    return [
      this.subject(sessionId, conversationId, agent),
      membership(
        sessionId,
        PRIME_AGENT_ID,
        conversationId,
        relays ? ORCHESTRATOR : ON_REQUEST,
      ),
    ];
  }

  /**
   * The membership of the participant whose Conversation this is. One on a
   * transport nothing can deliver to declares that it never acts, rather than
   * accepting wakes that would be swallowed.
   */
  private subject(
    sessionId: string,
    conversationId: string,
    agent: SessionAgent | undefined,
  ): Membership {
    const reachable = !agent || this.acceptsDelivery(agent.connector.kind);
    if (reachable) {
      return membership(sessionId, conversationId, conversationId, ADDRESSABLE);
    }
    return membership(
      sessionId,
      conversationId,
      conversationId,
      INERT,
      "opaque",
    );
  }
}
