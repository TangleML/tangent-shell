import type {
  Trigger,
  UpdateTriggerRequest,
} from "@tangent/shared/contracts.ts";

import {
  type IdentityAssertionCache,
  identityAssertions,
} from "../../auth/identityAssertions.ts";
import type {
  TriggerDelegation,
  TriggerDelegations,
} from "./triggerDelegation.ts";
import type { StoredTrigger, TriggerManager } from "./triggerManager.ts";

/** What binding a trigger to a person needs to consult. */
export interface TriggerBindingDeps {
  delegations: TriggerDelegations;
  assertions?: IdentityAssertionCache;
}

/** A backend delegation for the person, when they still hold a live assertion. */
async function delegate(
  deps: TriggerBindingDeps,
  triggerId: string,
  participantId: string,
): Promise<TriggerDelegation | undefined> {
  const assertion = (deps.assertions ?? identityAssertions).get(participantId);
  if (!assertion) return undefined;
  return deps.delegations.register(triggerId, participantId, assertion.token);
}

/**
 * Binds a trigger to the human behind the creating agent's turn: their id
 * always, plus a backend delegation when they hold a live assertion and
 * delegations are configured. A failed registration still leaves the trigger
 * bound to the person, without a delegation.
 */
export async function bindToParticipant(
  deps: TriggerBindingDeps,
  triggers: TriggerManager,
  sessionId: string,
  triggerId: string,
  participantId: string,
): Promise<void> {
  const delegation = await delegate(deps, triggerId, participantId);
  triggers.setDelegation(sessionId, triggerId, delegation ?? { participantId });
}

/**
 * Binds a trigger to the signed-in person who created or edited it from the
 * session API, when they hold a live assertion; a person the server cannot
 * act for leaves it unbound, so its firings run as the instance rather than
 * under a name nobody can vouch for.
 */
export async function bindToUser(
  deps: TriggerBindingDeps,
  triggers: TriggerManager,
  sessionId: string,
  triggerId: string,
  participantId: string | undefined,
): Promise<void> {
  const delegation =
    participantId && (await delegate(deps, triggerId, participantId));
  if (!delegation) return;
  triggers.setDelegation(sessionId, triggerId, delegation);
}

/** A trigger as it was before an edit and as it is after, plus the wire shape. */
export interface PatchedTrigger {
  before: StoredTrigger;
  after: StoredTrigger;
  trigger: Trigger;
}

/**
 * Applies an edit and reports what the trigger did before and after it. The
 * manager patches its record in place, so the "before" is copied out first.
 */
export function patchTrigger(
  triggers: TriggerManager,
  sessionId: string,
  triggerId: string,
  patch: UpdateTriggerRequest,
): PatchedTrigger | undefined {
  const current = triggers.getStored(sessionId, triggerId);
  if (!current) return undefined;
  const before = { ...current };
  const trigger = triggers.update(sessionId, triggerId, patch);
  const after = triggers.getStored(sessionId, triggerId);
  return trigger && after ? { before, after, trigger } : undefined;
}

function isBound(stored: StoredTrigger): boolean {
  return Boolean(stored.participantId || stored.delegationId);
}

function changesWhatFires(before: StoredTrigger, after: StoredTrigger) {
  return (
    before.prompt !== after.prompt ||
    JSON.stringify(before.schedule ?? null) !==
      JSON.stringify(after.schedule ?? null)
  );
}

/**
 * Whether an edit is new authorship: a bound trigger now does something else
 * when it fires. The person it was bound to never asked for this prompt or
 * this schedule, so their grant must not carry it.
 */
export function reauthored({ before, after }: PatchedTrigger): boolean {
  return isBound(before) && changesWhatFires(before, after);
}
