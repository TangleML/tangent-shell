import type {
  ListParticipantsResponse,
  MembershipView,
  ParticipantKind,
  ParticipantView,
  ParticipantWithMemberships,
} from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";

import type { ParticipantService } from "../../conversation/participantService.ts";
import { reactionSpec } from "../../conversation/reaction.ts";
import { getValidated, validate } from "../../middleware/validate.ts";
import type { Membership } from "../../store/membershipStore.ts";
import type { Participant } from "../../store/participantStore.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import type {
  InviteParticipantInput,
  JoinMembershipInput,
  MembershipParams,
  MuteMembershipInput,
  ParticipantParams,
  SessionParams,
} from "./schemas.ts";
import {
  inviteParticipantSchema,
  joinMembershipSchema,
  membershipParamsSchema,
  muteMembershipSchema,
  participantParamsSchema,
  sessionParamsSchema,
} from "./schemas.ts";
import { loadSession } from "./utils.ts";

const NEVER = reactionSpec("never");

/** Projects a {@link Participant} onto the REST DTO, hiding internal payloads. */
function toParticipantView(participant: Participant): ParticipantView {
  return {
    id: participant.id,
    sessionId: participant.sessionId,
    kind: participant.kind,
    displayName: participant.displayName,
    capabilities: participant.capabilities,
    presence: participant.presence,
    revokedAt: participant.revokedAt,
    createdAt: participant.createdAt,
  };
}

/**
 * Projects a {@link Membership} onto its DTO. Only an agent's Membership is
 * connector-woken, so only it can be muted; a human or automation is inert by
 * design, not muted, and reads back unmuted.
 */
function toMembershipView(
  membership: Membership,
  kind: ParticipantKind,
): MembershipView {
  return {
    conversationId: membership.conversationId,
    reaction: membership.reaction,
    ingress: membership.ingress,
    admission: membership.admission,
    muted: kind === "agent" && membership.reaction === NEVER,
  };
}

/** Responds `404 { error: "Participant not found" }`, matching `loadSession`. */
function participantNotFound(res: Response): void {
  res.status(404).json({ error: "Participant not found" });
}

/** `GET /:id/participants` → every Participant with its Memberships. */
async function handleListParticipants(
  store: SessionStore,
  participants: ParticipantService,
  id: string,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, id);
  if (!session) return;
  const rows = await participants.list(session.id);
  const views: ParticipantWithMemberships[] = await Promise.all(
    rows.map(async (participant) => ({
      ...toParticipantView(participant),
      memberships: (
        await participants.membershipsOf(session.id, participant.id)
      ).map((membership) => toMembershipView(membership, participant.kind)),
    })),
  );
  const body: ListParticipantsResponse = { participants: views };
  res.json(body);
}

/** `POST /:id/participants` → invite a person by email. */
async function handleInviteParticipant(
  store: SessionStore,
  participants: ParticipantService,
  id: string,
  body: InviteParticipantInput,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, id);
  if (!session) return;
  const participant = await participants.invite(session.id, body);
  res.status(201).json({ participant: toParticipantView(participant) });
}

/** `DELETE /:id/participants/:participantId` → revoke. */
async function handleRevokeParticipant(
  store: SessionStore,
  participants: ParticipantService,
  params: ParticipantParams,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, params.id);
  if (!session) return;
  if (!(await participants.get(session.id, params.participantId)))
    return participantNotFound(res);
  await participants.revoke(session.id, params.participantId);
  res.status(204).end();
}

/** `POST /:id/participants/:participantId/memberships` → join a Conversation. */
async function handleJoinMembership(
  store: SessionStore,
  participants: ParticipantService,
  params: ParticipantParams,
  body: JoinMembershipInput,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, params.id);
  if (!session) return;
  const participant = await participants.get(session.id, params.participantId);
  if (!participant) return participantNotFound(res);
  await participants.join(
    session.id,
    params.participantId,
    body.conversationId,
  );
  const memberships = await participants.membershipsOf(
    session.id,
    params.participantId,
  );
  const joined = memberships.find(
    (membership) => membership.conversationId === body.conversationId,
  );
  res.status(201).json({
    membership: joined ? toMembershipView(joined, participant.kind) : null,
  });
}

/**
 * `DELETE /:id/participants/:participantId/memberships/:conversationId` →
 * leave one Conversation, leaving the participant's others intact.
 */
async function handleLeaveMembership(
  store: SessionStore,
  participants: ParticipantService,
  params: MembershipParams,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, params.id);
  if (!session) return;
  await participants.leave(
    session.id,
    params.participantId,
    params.conversationId,
  );
  res.status(204).end();
}

/**
 * `PATCH /:id/participants/:participantId/memberships/:conversationId` →
 * mute/unmute. Only agent Memberships are connector-woken, so muting is
 * refused for a human or automation.
 */
async function handleMuteMembership(
  store: SessionStore,
  participants: ParticipantService,
  params: MembershipParams,
  body: MuteMembershipInput,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, params.id);
  if (!session) return;
  const participant = await participants.get(session.id, params.participantId);
  if (!participant) return participantNotFound(res);
  if (participant.kind !== "agent") {
    res.status(400).json({ error: "Only agent memberships can be muted" });
    return;
  }
  const membership = await participants.setMuted(
    session.id,
    params.participantId,
    params.conversationId,
    body.muted,
  );
  if (!membership) {
    res.status(404).json({ error: "Membership not found" });
    return;
  }
  res.json({ membership: toMembershipView(membership, participant.kind) });
}

/** Registers the participant collection + item routes (list, invite, revoke). */
function registerParticipantItemRoutes(
  router: Router,
  store: SessionStore,
  participants: ParticipantService,
): void {
  router.get(
    "/:id/participants",
    validate({ params: sessionParamsSchema }),
    (req: Request, res: Response) =>
      handleListParticipants(
        store,
        participants,
        getValidated<unknown, SessionParams>(req).params.id,
        res,
      ),
  );

  router.post(
    "/:id/participants",
    validate({ params: sessionParamsSchema, body: inviteParticipantSchema }),
    (req: Request, res: Response) => {
      const { params, body } = getValidated<
        InviteParticipantInput,
        SessionParams
      >(req);
      return handleInviteParticipant(store, participants, params.id, body, res);
    },
  );

  router.delete(
    "/:id/participants/:participantId",
    validate({ params: participantParamsSchema }),
    (req: Request, res: Response) =>
      handleRevokeParticipant(
        store,
        participants,
        getValidated<unknown, ParticipantParams>(req).params,
        res,
      ),
  );
}

/** Registers the membership routes (join, leave, mute) under a participant. */
function registerMembershipRoutes(
  router: Router,
  store: SessionStore,
  participants: ParticipantService,
): void {
  router.post(
    "/:id/participants/:participantId/memberships",
    validate({ params: participantParamsSchema, body: joinMembershipSchema }),
    (req: Request, res: Response) => {
      const { params, body } = getValidated<
        JoinMembershipInput,
        ParticipantParams
      >(req);
      return handleJoinMembership(store, participants, params, body, res);
    },
  );

  router.delete(
    "/:id/participants/:participantId/memberships/:conversationId",
    validate({ params: membershipParamsSchema }),
    (req: Request, res: Response) =>
      handleLeaveMembership(
        store,
        participants,
        getValidated<unknown, MembershipParams>(req).params,
        res,
      ),
  );

  router.patch(
    "/:id/participants/:participantId/memberships/:conversationId",
    validate({ params: membershipParamsSchema, body: muteMembershipSchema }),
    (req: Request, res: Response) => {
      const { params, body } = getValidated<
        MuteMembershipInput,
        MembershipParams
      >(req);
      return handleMuteMembership(store, participants, params, body, res);
    },
  );
}

/** Registers the participant + membership management routes on a session. */
export function registerParticipantRoutes(
  router: Router,
  store: SessionStore,
  participants: ParticipantService,
): void {
  registerParticipantItemRoutes(router, store, participants);
  registerMembershipRoutes(router, store, participants);
}
