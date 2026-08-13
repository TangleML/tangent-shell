import type {
  ReactionSpec,
  RunIngress,
  TranscriptVisibility,
} from "@tangent/shared/contracts.ts";

/**
 * A participant's standing in one Conversation. `reaction` decides whether it is
 * woken by what lands there, `ingress` classifies the work that arrives through
 * this membership when nothing more specific created it, and
 * `transcriptVisibility` says how much of the Conversation it may see.
 */
export interface Membership {
  sessionId: string;
  participantId: string;
  conversationId: string;
  reaction: ReactionSpec;
  ingress: RunIngress;
  transcriptVisibility: TranscriptVisibility;
}

/**
 * Durable home of the session's {@link Membership}s. Kept apart from
 * {@link import("./sessionStore.ts").SessionStore} for the same reason
 * {@link import("./runStore.ts").RunStore} is: it is read by one registry on the
 * delivery path, not by the REST routes.
 */
export interface MembershipStore {
  /** Every membership in a session, so a registry can seed one lookup. */
  listForSession(sessionId: string): Promise<Membership[]>;
  /** Every membership in one Conversation, so closing it can end each. */
  listForConversation(
    sessionId: string,
    conversationId: string,
  ): Promise<Membership[]>;
  /** One membership, or nothing when the participant holds none here. */
  get(
    sessionId: string,
    conversationId: string,
    participantId: string,
  ): Promise<Membership | undefined>;
  /** Upserts by `(sessionId, conversationId, participantId)`. */
  put(membership: Membership): Promise<void>;
  /** Removes one membership. A no-op when there is none to remove. */
  remove(
    sessionId: string,
    conversationId: string,
    participantId: string,
  ): Promise<void>;
}
