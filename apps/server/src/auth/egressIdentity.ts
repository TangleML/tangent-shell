import { EGRESS_IDENTITY_HEADER } from "../config.ts";
import type { RunDelegation, RunRegistry } from "../runs/runRegistry.ts";
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

/** Where a forwarded token came from, so a refusal can be charged to it. */
export type TokenSource =
  | { kind: "assertion" }
  | { kind: "delegation"; delegation: RunDelegation };

/** The token to forward and the identity it stands for. */
export interface ChosenIdentity {
  applied: AppliedIdentity;
  token?: string;
  source?: TokenSource;
}

/** The humans behind the caller's turn, as `GET /internal/egress/identity` reports them. */
export interface TurnIdentity {
  participants: { id: string; assertionExpiresAt?: string }[];
  acting: string | null;
}

/** What choosing an identity needs to consult. */
export interface EgressIdentityDeps {
  runs: Pick<RunRegistry, "participantsFor" | "delegationFor">;
  assertions?: IdentityAssertionCache;
  identityHeader?: string;
}

/** Raised when a caller names a participant who did not write into its turn. */
export class ParticipantNotInTurnError extends Error {
  readonly code = "participant_not_in_turn";

  constructor(participantId: string) {
    super(`${participantId} is not a participant of this turn.`);
    this.name = "ParticipantNotInTurnError";
  }
}

/**
 * Raised when the turn has people behind it but none of them can be carried:
 * the acting participant's assertion has expired and the turn holds no
 * delegation for them. Running as the instance here would quietly widen what
 * the agent may do, so the call is refused instead.
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

/** The named member of the set, or its most recent; a non-member is refused. */
function pickParticipant(
  participants: string[],
  onBehalfOf: string | undefined,
): string | undefined {
  if (onBehalfOf === undefined) return participants.at(-1);
  if (!participants.includes(onBehalfOf)) {
    throw new ParticipantNotInTurnError(onBehalfOf);
  }
  return onBehalfOf;
}

/** The turn's delegation for this person, else their live assertion. */
function tokenFor(
  deps: EgressIdentityDeps,
  caller: AgentCaller,
  participantId: string,
): { token: string; source: TokenSource } | undefined {
  const delegation = deps.runs.delegationFor(caller.sessionId, caller.agentId);
  if (delegation?.participantId === participantId) {
    return {
      token: delegation.token,
      source: { kind: "delegation", delegation },
    };
  }
  const held = (deps.assertions ?? identityAssertions).get(participantId);
  return held && { token: held.token, source: { kind: "assertion" } };
}

/**
 * Decides who an egress call acts as: the named `onBehalfOf` member of the
 * caller's identity set, else its most recent member, carrying that person's
 * live assertion or the trigger delegation the turn runs under. The instance
 * identity is used only when forwarding is off or the turn has nobody behind
 * it. A participant who cannot be carried is a refusal, as is an unidentified
 * caller once forwarding is configured, so nothing runs as the instance merely
 * because a token expired or was left out.
 */
export function chooseEgressIdentity(
  deps: EgressIdentityDeps,
  caller: AgentCaller | undefined,
  onBehalfOf: string | undefined,
): ChosenIdentity {
  if (!configured(deps)) return instance("not_configured");
  if (!caller) throw new CallerRequiredError();
  const participantId = pickParticipant(
    deps.runs.participantsFor(caller.sessionId, caller.agentId),
    onBehalfOf,
  );
  if (!participantId) return instance("no_participant");

  const carried = tokenFor(deps, caller, participantId);
  if (!carried) throw new ParticipantAssertionExpiredError(participantId);
  return { applied: { kind: "participant", id: participantId }, ...carried };
}

/** The caller's identity set with each member's assertion expiry, if held. */
export function describeTurnIdentity(
  deps: EgressIdentityDeps,
  caller: AgentCaller | undefined,
): TurnIdentity {
  if (!caller) return { participants: [], acting: null };
  const assertions = deps.assertions ?? identityAssertions;
  const ids = deps.runs.participantsFor(caller.sessionId, caller.agentId);
  return {
    participants: ids.map((id) => {
      const expiresAt = assertions.get(id)?.expiresAt?.toISOString();
      return expiresAt ? { id, assertionExpiresAt: expiresAt } : { id };
    }),
    acting: ids.at(-1) ?? null,
  };
}
