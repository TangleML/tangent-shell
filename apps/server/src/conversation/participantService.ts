import {
  connectorFor,
  type ParticipantKind,
  type ParticipantPresencePayload,
  type Presence,
  type RunIngress,
} from "@tangent/shared/contracts.ts";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import type { RunRegistry } from "../runs/runRegistry.ts";
import type { Membership, MembershipStore } from "../store/membershipStore.ts";
import type {
  Participant,
  ParticipantStore,
} from "../store/participantStore.ts";
import type { MembershipRegistry } from "./membershipRegistry.ts";
import type { ParticipantRegistry } from "./participantRegistry.ts";
import { reactionSpec } from "./reaction.ts";

/** What a person or another participant reacts to in a Conversation it is in. */
const ADDRESSABLE = reactionSpec("fromHumans", "mentionsMe");

/**
 * A member that never reacts. Humans and automations hold this in the
 * session-scoped transport: a human reads the room broadcast rather than being
 * woken through a connector, and an automation is an ingress source, not a
 * reactor. Anything reactive on a connector-less participant would fire the
 * fallback connector's "not available" notice. 2.3's rooms make a human's
 * reaction meaningful.
 */
const INERT = reactionSpec("never");

/** The presence an invited-but-not-yet-connected person holds. */
const INVITED_PRESENCE: Presence = "away";

/** Details of a person being invited into a session. */
export interface InviteInput {
  /** The person's email — their server-resolved, stable Participant id. */
  email: string;
  displayName?: string;
  /** Conversations to grant Membership in; empty means the session only. */
  conversationIds?: string[];
}

/** The reaction a freshly-joined participant of a given kind holds. */
function reactionFor(kind: ParticipantKind | undefined): string {
  return kind === "agent" ? ADDRESSABLE : INERT;
}

/**
 * The lifecycle of a session's Participants and their Memberships: who is in a
 * session, which Conversations they hold Membership in, whether they are present
 * right now, and when they leave. This is the first runtime consumer of
 * {@link ParticipantRegistry} — 2.1 left it unit-tested only.
 *
 * `session_agents` stays the write authority for agents; this service owns the
 * rows agents never produce — humans and automations — and the Membership edits
 * (join, leave, mute, close) that are nobody's to make until a Conversation can
 * hold more than one actor.
 */
export class ParticipantService {
  private readonly participants: ParticipantStore;
  private readonly memberships: MembershipStore;
  private readonly participantRegistry: ParticipantRegistry;
  private readonly membershipRegistry: MembershipRegistry;
  private readonly runs: RunRegistry;
  private readonly connectors: ConnectorRegistry;
  private readonly onPresence:
    | ((payload: ParticipantPresencePayload) => void)
    | undefined;

  constructor(
    participants: ParticipantStore,
    memberships: MembershipStore,
    participantRegistry: ParticipantRegistry,
    membershipRegistry: MembershipRegistry,
    runs: RunRegistry,
    connectors: ConnectorRegistry,
    onPresence?: (payload: ParticipantPresencePayload) => void,
  ) {
    this.participants = participants;
    this.memberships = memberships;
    this.participantRegistry = participantRegistry;
    this.membershipRegistry = membershipRegistry;
    this.runs = runs;
    this.connectors = connectors;
    this.onPresence = onPresence;
  }

  /** Every Participant in a session, roster rows reconciled, revoked included. */
  async list(sessionId: string): Promise<Participant[]> {
    return this.participantRegistry.listForSession(sessionId);
  }

  /** One Participant, or nothing when the session holds no such id. */
  async get(sessionId: string, id: string): Promise<Participant | undefined> {
    return this.participantRegistry.get(sessionId, id);
  }

  /** The Memberships one Participant holds across the session. */
  async membershipsOf(
    sessionId: string,
    participantId: string,
  ): Promise<Membership[]> {
    const all = await this.memberships.listForSession(sessionId);
    return all.filter(
      (membership) => membership.participantId === participantId,
    );
  }

  /**
   * Invites a person into the session: a Human Participant keyed by their email,
   * plus a Membership in each granted Conversation. Re-inviting a revoked person
   * clears the revocation rather than orphaning the old row.
   */
  async invite(sessionId: string, input: InviteInput): Promise<Participant> {
    const existing = await this.participants.get(sessionId, input.email);
    const participant: Participant = {
      id: input.email,
      sessionId,
      kind: "human",
      displayName: input.displayName ?? input.email,
      capabilities: [],
      presence: INVITED_PRESENCE,
      connector: connectorFor("unresolved"),
      revokedAt: undefined,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    await this.participants.put(participant);
    for (const conversationId of input.conversationIds ?? [])
      await this.addMembership(sessionId, input.email, conversationId, INERT);
    this.invalidate(sessionId);
    return participant;
  }

  /**
   * Revokes a Participant: removes every Membership and stamps the row revoked
   * (dropping its capabilities) rather than deleting it, so a transcript keeps
   * its attributions. Marks them detached so clients stop showing them present.
   */
  async revoke(sessionId: string, participantId: string): Promise<void> {
    for (const membership of await this.membershipsOf(sessionId, participantId))
      await this.memberships.remove(
        sessionId,
        membership.conversationId,
        participantId,
      );
    await this.participants.revoke(sessionId, participantId);
    await this.participants.updatePresence(
      sessionId,
      participantId,
      "detached",
    );
    this.invalidate(sessionId);
    this.onPresence?.({ sessionId, participantId, presence: "detached" });
  }

  /** Adds a Participant to a Conversation with its kind's default reaction. */
  async join(
    sessionId: string,
    participantId: string,
    conversationId: string,
  ): Promise<void> {
    const participant = await this.participants.get(sessionId, participantId);
    await this.addMembership(
      sessionId,
      participantId,
      conversationId,
      reactionFor(participant?.kind),
    );
    this.membershipRegistry.invalidate(sessionId);
  }

  /** Removes a Participant from one Conversation, leaving the others intact. */
  async leave(
    sessionId: string,
    participantId: string,
    conversationId: string,
  ): Promise<void> {
    await this.memberships.remove(sessionId, conversationId, participantId);
    this.membershipRegistry.invalidate(sessionId);
  }

  /**
   * Mutes or unmutes an agent's Membership: a muted member never reacts;
   * unmuting restores the addressable default. Only agent Memberships are
   * connector-woken, so muting one is what stops it — a human's delivery is the
   * room, not a reaction.
   */
  async setMuted(
    sessionId: string,
    participantId: string,
    conversationId: string,
    muted: boolean,
  ): Promise<Membership | undefined> {
    const existing = await this.memberships.get(
      sessionId,
      conversationId,
      participantId,
    );
    if (!existing) return undefined;
    const next: Membership = {
      ...existing,
      reaction: muted ? INERT : ADDRESSABLE,
    };
    await this.memberships.put(next);
    this.membershipRegistry.invalidate(sessionId);
    return next;
  }

  /**
   * Closes a Conversation: ends every Membership and settles its open Runs. The
   * open Run belongs to the Conversation's subject participant, which is no
   * longer the Conversation id itself — so reverse-map before cancelling.
   */
  async closeConversation(
    sessionId: string,
    conversationId: string,
  ): Promise<void> {
    const members = await this.memberships.listForConversation(
      sessionId,
      conversationId,
    );
    for (const member of members)
      await this.memberships.remove(
        sessionId,
        conversationId,
        member.participantId,
      );
    const owner = await this.participantRegistry.ownerOf(
      sessionId,
      conversationId,
    );
    this.connectors.cancelRun({ sessionId, participantId: owner });
    this.runs.settleOpenFor(sessionId, owner, "cancelled");
    this.membershipRegistry.invalidate(sessionId);
  }

  /**
   * Materializes an Automation Participant (memory, a trigger) and its inert
   * Membership in the orchestrator's Conversation, once per session. The synthetic
   * `MEMORY_AUTHOR` / `TRIGGER_AUTHOR` still author the Messages; this makes the
   * actor behind them a real, listable Participant with an ingress.
   */
  async ensureAutomation(
    sessionId: string,
    id: string,
    displayName: string,
    ingress: RunIngress,
  ): Promise<void> {
    if (await this.participants.get(sessionId, id)) return;
    await this.participants.put({
      id,
      sessionId,
      kind: "automation",
      displayName,
      capabilities: [],
      presence: "connected",
      connector: connectorFor("unresolved"),
      createdAt: new Date().toISOString(),
    });
    const orchestratorId =
      await this.participantRegistry.orchestratorId(sessionId);
    await this.addMembership(sessionId, id, orchestratorId, INERT, ingress);
    this.invalidate(sessionId);
  }

  /**
   * Records a Participant's live {@link Presence} and broadcasts it. A revoked or
   * absent Participant, or one already in this presence, is left alone.
   */
  async setPresence(
    sessionId: string,
    participantId: string,
    presence: Presence,
  ): Promise<void> {
    const existing = await this.participants.get(sessionId, participantId);
    if (!existing || existing.revokedAt) return;
    if (existing.presence === presence) return;
    await this.participants.updatePresence(sessionId, participantId, presence);
    this.participantRegistry.invalidate(sessionId);
    this.onPresence?.({ sessionId, participantId, presence });
  }

  /**
   * Persists one Membership. Derives the Conversation's base Memberships first:
   * `MembershipRegistry.membersOf` returns stored rows verbatim once any exist,
   * so writing a row before the orchestrator/subject rows are persisted would
   * drop them from the set.
   */
  private async addMembership(
    sessionId: string,
    participantId: string,
    conversationId: string,
    reaction: string,
    ingress: RunIngress = "reaction",
  ): Promise<void> {
    await this.membershipRegistry.membersOf(sessionId, conversationId);
    await this.memberships.put({
      sessionId,
      participantId,
      conversationId,
      reaction,
      ingress,
      transcriptVisibility: "shared",
    });
  }

  private invalidate(sessionId: string): void {
    this.participantRegistry.invalidate(sessionId);
    this.membershipRegistry.invalidate(sessionId);
  }
}
