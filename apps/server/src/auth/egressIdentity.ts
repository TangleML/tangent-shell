import { EGRESS_IDENTITY_HEADER } from "../config.ts";
import type { RunRegistry } from "../runs/runRegistry.ts";
import type { AgentCaller } from "./agentCaller.ts";
import {
  type IdentityAssertionCache,
  identityAssertions,
} from "./identityAssertions.ts";

/** Why an egress call ran as the instance rather than as a participant. */
export type InstanceReason =
  | "not_configured"
  | "no_participant"
  | "assertion_expired"
  | "unknown_caller";

/** Who an egress call acted as, reported back to the agent that made it. */
export type AppliedIdentity =
  | { kind: "participant"; id: string }
  | { kind: "instance"; reason: InstanceReason };

/** The token to forward and the identity it stands for. */
export interface ChosenIdentity {
  applied: AppliedIdentity;
  token?: string;
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

function instance(reason: InstanceReason): ChosenIdentity {
  return { applied: { kind: "instance", reason } };
}

function configured(deps: EgressIdentityDeps): boolean {
  return (deps.identityHeader ?? EGRESS_IDENTITY_HEADER).length > 0;
}

function participantsOf(
  deps: EgressIdentityDeps,
  caller: AgentCaller | undefined,
): string[] {
  if (!caller) return [];
  return deps.runs.participantsFor(caller.sessionId, caller.agentId);
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
): string | undefined {
  const delegation = deps.runs.delegationFor(caller.sessionId, caller.agentId);
  if (delegation?.participantId === participantId) return delegation.token;
  return (deps.assertions ?? identityAssertions).get(participantId)?.token;
}

/**
 * Decides who an egress call acts as: the named `onBehalfOf` member of the
 * caller's identity set, else its most recent member, carrying that person's
 * live assertion or the trigger delegation the turn runs under. Falls back to
 * the instance, saying why, whenever no participant can be carried.
 */
export function chooseEgressIdentity(
  deps: EgressIdentityDeps,
  caller: AgentCaller | undefined,
  onBehalfOf: string | undefined,
): ChosenIdentity {
  if (!configured(deps)) return instance("not_configured");
  const participantId = pickParticipant(
    participantsOf(deps, caller),
    onBehalfOf,
  );
  if (!caller) return instance("unknown_caller");
  if (!participantId) return instance("no_participant");

  const token = tokenFor(deps, caller, participantId);
  if (!token) return instance("assertion_expired");
  return { applied: { kind: "participant", id: participantId }, token };
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
