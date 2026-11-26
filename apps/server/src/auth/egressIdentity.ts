import { EGRESS_IDENTITY_HEADER } from "../config.ts";
import type { RunRegistry } from "../runs/runRegistry.ts";
import type { AgentCaller } from "./agentCaller.ts";
import {
  type IdentityAssertionCache,
  identityAssertions,
} from "./identityAssertions.ts";

/** Why an egress call ran as the instance rather than as a participant. */
export type InstanceReason = "not_configured" | "no_participant";

/** Who an egress call acted as, reported back to the agent that made it. */
export type AppliedIdentity =
  | { kind: "participant"; id: string }
  | { kind: "instance"; reason: InstanceReason };

/** The token to forward and the identity it stands for. */
export interface ChosenIdentity {
  applied: AppliedIdentity;
  token?: string;
}

/** One participant as `GET /internal/egress/identity` reports them. */
export interface TurnParticipant {
  id: string;
  assertionExpiresAt?: string;
}

/** The human behind the caller's turn, or nobody. */
export interface TurnIdentity {
  participant: TurnParticipant | null;
}

/** What choosing an identity needs to consult. */
export interface EgressIdentityDeps {
  runs: Pick<RunRegistry, "audienceFor">;
  assertions?: IdentityAssertionCache;
  identityHeader?: string;
}

/**
 * Raised when the turn has a person behind it whose assertion has expired.
 * Running as the instance here would quietly widen what the agent may do, so
 * the call is refused instead.
 */
export class ParticipantAssertionExpiredError extends Error {
  readonly code = "participant_assertion_expired";

  constructor(participantId: string) {
    super(
      `${participantId}'s identity assertion has expired; the call cannot be made on their behalf.`,
    );
    this.name = "ParticipantAssertionExpiredError";
  }
}

/** Raised when identity forwarding is on but the call presents no agent token. */
export class CallerRequiredError extends Error {
  readonly code = "caller_required";

  constructor() {
    super("Acting on behalf of a participant needs the calling agent's token.");
    this.name = "CallerRequiredError";
  }
}

function instance(reason: InstanceReason): ChosenIdentity {
  return { applied: { kind: "instance", reason } };
}

function configured(deps: EgressIdentityDeps): boolean {
  return (deps.identityHeader ?? EGRESS_IDENTITY_HEADER).length > 0;
}

function assertionsOf(deps: EgressIdentityDeps): IdentityAssertionCache {
  return deps.assertions ?? identityAssertions;
}

/**
 * Decides who an egress call acts as: the human behind the caller's turn,
 * carrying that person's live assertion. The instance identity is used only
 * when forwarding is off or the turn has nobody behind it. A participant whose
 * assertion has expired is a refusal, as is an unidentified caller once
 * forwarding is configured, so nothing runs as the instance merely because a
 * token expired or was left out.
 */
export function chooseEgressIdentity(
  deps: EgressIdentityDeps,
  caller: AgentCaller | undefined,
): ChosenIdentity {
  if (!configured(deps)) return instance("not_configured");
  if (!caller) throw new CallerRequiredError();
  const participantId = deps.runs.audienceFor(caller.sessionId, caller.agentId);
  if (!participantId) return instance("no_participant");

  const held = assertionsOf(deps).get(participantId);
  if (!held) throw new ParticipantAssertionExpiredError(participantId);
  return {
    applied: { kind: "participant", id: participantId },
    token: held.token,
  };
}

function participantOf(deps: EgressIdentityDeps, id: string): TurnParticipant {
  const expiresAt = assertionsOf(deps).get(id)?.expiresAt;
  return expiresAt
    ? { id, assertionExpiresAt: expiresAt.toISOString() }
    : { id };
}

/** The human behind the caller's turn, with their assertion's expiry if held. */
export function describeTurnIdentity(
  deps: EgressIdentityDeps,
  caller: AgentCaller | undefined,
): TurnIdentity {
  const id = caller && deps.runs.audienceFor(caller.sessionId, caller.agentId);
  return { participant: id ? participantOf(deps, id) : null };
}
