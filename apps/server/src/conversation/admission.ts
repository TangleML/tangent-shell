import type { AdmissionPolicy, Run } from "@tangent/shared/contracts.ts";

import type { CancelResult, RunCancellation } from "../connectors/types.ts";
import type { RunRegistry } from "../runs/runRegistry.ts";
import type { TerminationCause } from "./causes.ts";

/**
 * How the engine cancels an in-progress Run for `preempt`. Injected so the
 * engine depends on the ability to cancel, not on the connector registry.
 */
export type CancelRun = (request: RunCancellation) => CancelResult;

/** A wake held until its participant's open Run settles. `deliver` performs the
 * delivery the fan-out engine deferred; the engine invokes it on release. */
interface PendingWake {
  sessionId: string;
  participantId: string;
  conversationId: string;
  deliver: () => void;
}

/** What the fan-out engine should do with a wake, once admission has decided. */
export type AdmissionDecision =
  | { action: "now" }
  | { action: "held" }
  | { action: "rejected"; cause: TerminationCause };

/** One wake to admit: who it is for, its Membership's policy, and the delivery
 * to run now or defer. */
export interface AdmissionRequest {
  sessionId: string;
  participantId: string;
  conversationId: string;
  policy: AdmissionPolicy;
  /** The fan-out wave depth this wake arrived in, stamped onto a rejection
   * cause so a supervisor can locate it. */
  waveDepth: number;
  /** Performs the connector delivery. Called now for `queue`/idle, or on release
   * for a held `coalesce`/`preempt`. */
  deliver: () => void;
}

function keyFor(
  sessionId: string,
  participantId: string,
  conversationId: string,
): string {
  return `${sessionId}\u0000${participantId}\u0000${conversationId}`;
}

function participantKey(sessionId: string, participantId: string): string {
  return `${sessionId}\u0000${participantId}`;
}

/**
 * What a wake does when its participant already has an open {@link Run}
 * (unified-model §9.5). A single agent per thread made a concurrent wake rare
 * enough to leave implicit; several participants make it ordinary, so a
 * Membership's `admission` policy makes the behavior explicit:
 *
 * - `queue` — deliver as today; a mid-run message joins the Run in flight.
 * - `coalesce` — hold a single latest wake and release it when the Run settles.
 * - `preempt` — cancel the Run and deliver, holding the restart until the
 *   cancelled Run actually settles when the connector only signals an abort.
 * - `reject` — refuse and emit a cause.
 *
 * The held set is process-local, like 3.1's reactor timers and 3.2's
 * outstanding correlations: an open Run only exists while the process that
 * opened it lives, so a wake queued behind one need not outlive it.
 */
export class AdmissionEngine {
  private readonly runs: RunRegistry;
  private readonly cancel: CancelRun;
  /** One held wake per (session, participant, conversation). `coalesce` keeps
   * the latest; `preempt` holds the restart until the cancelled Run settles. */
  private readonly pending = new Map<string, PendingWake>();
  /** Participants mid-release, so a wake that opens a Run cannot re-enter. */
  private readonly releasing = new Set<string>();

  constructor(runs: RunRegistry, cancel: CancelRun) {
    this.runs = runs;
    this.cancel = cancel;
  }

  /**
   * Decides what a wake does against its participant's current Run. `now` when
   * the participant is idle or the policy is `queue`; `held` when the wake is
   * deferred to the Run's settle; `rejected` with a cause for `reject` and for a
   * `preempt` nothing could cancel.
   */
  admit(request: AdmissionRequest): AdmissionDecision {
    const { sessionId, participantId, policy } = request;
    const open = this.runs.current(sessionId, participantId);
    if (!open || policy === "queue") return { action: "now" };
    if (policy === "reject") {
      return { action: "rejected", cause: this.cause(request) };
    }
    if (policy === "coalesce") {
      this.hold(request);
      return { action: "held" };
    }
    return this.preempt(request, open);
  }

  /**
   * Fires whatever wake a now-settled participant was holding. A no-op unless
   * the participant is idle again, so a held wake never lands on top of the Run
   * that replaced the one it was queued behind.
   */
  release(run: Run): void {
    const { sessionId, participantId } = run;
    const guard = participantKey(sessionId, participantId);
    if (this.releasing.has(guard)) return;
    if (this.runs.current(sessionId, participantId)) return;

    this.releasing.add(guard);
    try {
      this.fireHeld(sessionId, participantId);
    } finally {
      this.releasing.delete(guard);
    }
  }

  /** Fires the held wakes for one idle participant, stopping as soon as a
   * delivery opens a fresh Run so a burst does not pile onto one turn. */
  private fireHeld(sessionId: string, participantId: string): void {
    for (const [key, wake] of this.pending) {
      if (wake.sessionId !== sessionId) continue;
      if (wake.participantId !== participantId) continue;
      this.pending.delete(key);
      wake.deliver();
      if (this.runs.current(sessionId, participantId)) break;
    }
  }

  /** How many wakes are held for a participant — the admission queue depth the
   * workflow view (3.6) reads. */
  depthFor(sessionId: string, participantId: string): number {
    let depth = 0;
    for (const wake of this.pending.values()) {
      if (wake.sessionId !== sessionId) continue;
      if (wake.participantId === participantId) depth += 1;
    }
    return depth;
  }

  /** Every held wake in a session, for the in-process workflow read. */
  listForSession(
    sessionId: string,
  ): { participantId: string; conversationId: string }[] {
    const held: { participantId: string; conversationId: string }[] = [];
    for (const wake of this.pending.values()) {
      if (wake.sessionId !== sessionId) continue;
      held.push({
        participantId: wake.participantId,
        conversationId: wake.conversationId,
      });
    }
    return held;
  }

  private preempt(request: AdmissionRequest, open: Run): AdmissionDecision {
    const { cancelled } = this.cancel({
      sessionId: request.sessionId,
      participantId: request.participantId,
      runId: open.id,
    });
    if (!cancelled) return { action: "rejected", cause: this.cause(request) };
    // A connector that settles synchronously (A2A) leaves the participant idle,
    // so the restart goes now; one that only signals an abort (Pi) keeps the Run
    // until its stream ends, so the restart waits for that settle.
    if (!this.runs.current(request.sessionId, request.participantId)) {
      return { action: "now" };
    }
    this.hold(request);
    return { action: "held" };
  }

  private hold(request: AdmissionRequest): void {
    this.pending.set(
      keyFor(request.sessionId, request.participantId, request.conversationId),
      {
        sessionId: request.sessionId,
        participantId: request.participantId,
        conversationId: request.conversationId,
        deliver: request.deliver,
      },
    );
  }

  private cause(request: AdmissionRequest): TerminationCause {
    return {
      kind: "admission-rejected",
      policy: request.policy,
      participantId: request.participantId,
      conversationId: request.conversationId,
      runId: this.runs.current(request.sessionId, request.participantId)?.id,
      waveDepth: request.waveDepth,
    };
  }
}
