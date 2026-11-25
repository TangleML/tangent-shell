import type {
  SubagentStatus,
  TriggerDisabledReason,
} from "@tangent/shared/contracts.ts";
import { isTerminalStatus } from "@tangent/shared/contracts.ts";

import { parseDuration } from "./duration.ts";
import type { StoredTrigger } from "./triggerManager.ts";

/** What is known about a trigger's dedicated sub-agent when it is checked. */
export interface TargetState {
  /** The sub-agent's persisted roster status, when it has a row. */
  status?: SubagentStatus;
  /** Whether a process for it is running in this server right now. */
  live: boolean;
}

/** When a trigger is being checked, which decides the rules that apply. */
export type LifecycleCheck =
  /** Before a firing is delivered. */
  | "fire"
  /**
   * Re-arming a session someone opened (chat join): the server may have
   * restarted since the trigger last ran, so dormant watchers are retired.
   */
  | "wake"
  /**
   * Re-arming a session someone deliberately woke (unarchive): archiving
   * detaches every sub-agent on purpose, so that alone doesn't retire a
   * trigger; only expiry, fire budget and ended targets do.
   */
  | "resume";

/** Whether a trigger's lifetime has run out at `now`. */
function isExpired(trigger: StoredTrigger, now: number): boolean {
  if (!trigger.expiresAt) return false;
  const at = Date.parse(trigger.expiresAt);
  return Number.isFinite(at) && at <= now;
}

/** Whether a trigger has delivered its whole fire budget. */
function isExhausted(trigger: StoredTrigger): boolean {
  return (
    trigger.maxFires !== undefined &&
    (trigger.fireCount ?? 0) >= trigger.maxFires
  );
}

/**
 * Why an enabled trigger should be switched off now, or `undefined` to keep it.
 *
 * - Expired or exhausted triggers stop at any check.
 * - A trigger whose dedicated sub-agent ended (completed, killed, errored) stops
 *   rather than respawning a fresh worker for a job that is over.
 * - On wake, a **schedule** trigger whose sub-agent is detached and not running
 *   (the server restarted or the session slept) stops unless an `expiresAt`
 *   says it should outlive that. Without this, opening a session days later
 *   resurrects a watcher nobody is waiting on. Callback triggers are left
 *   alone: they cost nothing until called, and a callback reviving its worker
 *   after a restart is the point of them.
 */
export function retirementReason(
  trigger: StoredTrigger,
  target: TargetState | undefined,
  check: LifecycleCheck,
  now: number = Date.now(),
): TriggerDisabledReason | undefined {
  if (!trigger.enabled) return undefined;
  return lifetimeReason(trigger, now) ?? targetReason(trigger, target, check);
}

/** `expired` / `max-fires` when the trigger's own bounds are hit. */
function lifetimeReason(
  trigger: StoredTrigger,
  now: number,
): TriggerDisabledReason | undefined {
  if (isExpired(trigger, now)) return "expired";
  if (isExhausted(trigger)) return "max-fires";
  return undefined;
}

/** Why the state of a trigger's dedicated sub-agent should stop it, if it does. */
function targetReason(
  trigger: StoredTrigger,
  target: TargetState | undefined,
  check: LifecycleCheck,
): TriggerDisabledReason | undefined {
  if (trigger.target.type !== "subagent" || !target?.status) return undefined;
  if (isTerminalStatus(target.status)) return "target-ended";
  return isDormant(trigger, target, check) ? "target-detached" : undefined;
}

/**
 * On wake, a schedule whose sub-agent is detached and not running, with no
 * expiry saying it should outlive that.
 */
function isDormant(
  trigger: StoredTrigger,
  target: TargetState,
  check: LifecycleCheck,
): boolean {
  return (
    check === "wake" &&
    trigger.kind === "schedule" &&
    target.status === "detached" &&
    !target.live &&
    !trigger.expiresAt
  );
}

/**
 * Whether a sub-agent's new status should stop the triggers that target it: it
 * ended, or it dropped while the trigger had no expiry to outlive the drop.
 */
export function retiresOnStatus(
  trigger: StoredTrigger,
  status: SubagentStatus,
): TriggerDisabledReason | undefined {
  if (!trigger.enabled) return undefined;
  if (isTerminalStatus(status)) return "target-ended";
  if (status === "detached" && trigger.kind === "schedule") {
    return trigger.expiresAt ? undefined : "target-detached";
  }
  return undefined;
}

/**
 * Resolves a requested lifetime to an absolute ISO time: an explicit
 * `expiresAt` wins, else `expiresIn` (a duration) counts from `now`. Throws on
 * a malformed value or one already in the past.
 */
export function resolveExpiry(
  expiresAt: string | undefined,
  expiresIn: string | undefined,
  now: number = Date.now(),
): string | undefined {
  if (expiresAt) return absoluteExpiry(expiresAt, now);
  if (expiresIn) return relativeExpiry(expiresIn, now);
  return undefined;
}

/** Validates an absolute expiry: a parseable time in the future. */
function absoluteExpiry(expiresAt: string, now: number): string {
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) {
    throw new Error("`expiresAt` must be an ISO-8601 timestamp");
  }
  if (at <= now) throw new Error("`expiresAt` must be in the future");
  return new Date(at).toISOString();
}

/** Turns a lifetime duration into an absolute expiry counted from `now`. */
function relativeExpiry(expiresIn: string, now: number): string {
  const ms = parseDuration(expiresIn);
  if (!ms) {
    throw new Error('`expiresIn` must be a duration like "6h", "2d", "30m"');
  }
  return new Date(now + ms).toISOString();
}

/** Validates a fire budget: a positive integer, or absent. */
export function validateMaxFires(
  maxFires: number | undefined,
): number | undefined {
  if (maxFires === undefined) return undefined;
  if (!Number.isInteger(maxFires) || maxFires < 1) {
    throw new Error("`maxFires` must be a positive integer");
  }
  return maxFires;
}
