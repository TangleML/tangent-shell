import { randomUUID } from "node:crypto";

import type {
  Run,
  RunId,
  RunIngress,
  RunStatus,
} from "@tangent/shared/contracts.ts";

import type { RunStore } from "../store/runStore.ts";

/** What a connector supplies to open a {@link Run}. */
export interface OpenRunInput {
  sessionId: string;
  participantId: string;
  /**
   * The Conversation this Run's output lands in. Defaults to `participantId`
   * only as a legacy fallback (an agent whose Conversation is still keyed by its
   * own id); a spawner that minted a distinct Conversation passes it explicitly.
   */
  homeConversationId?: string;
  ingress: RunIngress;
  /** The far side's own id for this work, when the connector has one. */
  externalId?: string;
  /** Initial resume cursor, when the connector streams by cursor. */
  cursor?: string;
  /**
   * The human whose prompt opened this Run, when a human woke the participant.
   * Becomes the Run's identity set on its own: remote tools called during the
   * Run target this person's host, and calls made on someone's behalf act as
   * them.
   */
  audienceParticipantId?: string;
  /**
   * The identity set a relay carries: when one agent's Run messages another
   * (a sub-agent's report, an orchestrator's directive), the people behind the
   * sending Run become the people behind the Run it wakes. A wake with neither
   * this nor an audience acts for nobody.
   */
  audienceParticipants?: readonly string[];
  delegation?: RunDelegation;
}

/**
 * The humans behind one Run, oldest first. The most recent is the acting
 * default: the one a remote tool routes to and an egress call acts for unless
 * another member is named. Lives and dies with the Run: nothing is inherited
 * by the participant's next wake unless a relay carries it there.
 */
export interface RunIdentity {
  participants: string[];
  delegation?: RunDelegation;
}

/**
 * A standing grant one participant gave a trigger: the token egress forwards
 * for them once the Run was opened by that trigger rather than by a message.
 */
export interface RunDelegation {
  triggerId: string;
  participantId: string;
  token: string;
}

/** The terminal states {@link RunRegistry.settle} accepts. */
export type SettledStatus = Exclude<RunStatus, "running">;

/** How a Run came to settle, as its listener is told. */
export interface Settlement {
  /** Settled only because its participant's next Run was opening. */
  superseded: boolean;
}

/** Composite key of the at-most-one Run a participant has open. */
function keyFor(sessionId: string, participantId: string): string {
  return `${sessionId}\u0000${participantId}`;
}

/**
 * The server's index of {@link Run}s: which participant is working, under which
 * id, so a stream can be attributed and cancellation has something to act on.
 *
 * Open Runs are held in memory and written through to the {@link RunStore}. In
 * memory is authoritative for "what is running now" — a Run only exists while
 * the process that opened it lives — and the table is the durable record of what
 * ran, which is what makes a Run inspectable after the fact.
 *
 * Runs are serial per participant: {@link open} settles whichever Run that
 * participant still had open. That is what bounds a connector whose protocol has
 * no run-end marker.
 */
export class RunRegistry {
  private readonly store: RunStore;
  /** Open runs by `(sessionId, participantId)`. */
  private readonly byParticipant = new Map<string, Run>();
  /** The same runs by id, so a client-supplied run id resolves directly. */
  private readonly byId = new Map<RunId, Run>();
  /** Each open Run's identity set, by run id; it dies with the Run. */
  private readonly identityByRun = new Map<RunId, RunIdentity>();
  /** Notified after a Run settles, so a participant becoming idle can release a
   * wake that was held behind it. */
  private onSettled?: (run: Run, settlement: Settlement) => void;

  constructor(store: RunStore) {
    this.store = store;
  }

  /** Registers the one listener told when a Run settles. Separate from the
   * constructor because the admission engine that listens is wired after. */
  useOnSettled(handler: (run: Run, settlement: Settlement) => void): void {
    this.onSettled = handler;
  }

  /**
   * Opens a Run for a participant, settling any Run it still had open as
   * `completed`. Returns synchronously — the caller is on the streaming path —
   * with persistence following behind.
   */
  open(input: OpenRunInput): Run {
    const previous = this.current(input.sessionId, input.participantId);
    if (previous) this.finish(previous, "completed", { superseded: true });

    const now = new Date().toISOString();
    const run: Run = {
      id: randomUUID(),
      sessionId: input.sessionId,
      participantId: input.participantId,
      homeConversationId: input.homeConversationId ?? input.participantId,
      status: "running",
      ingress: input.ingress,
      externalId: input.externalId,
      cursor: input.cursor,
      createdAt: now,
      updatedAt: now,
    };

    this.byParticipant.set(keyFor(run.sessionId, run.participantId), run);
    this.byId.set(run.id, run);
    this.identityByRun.set(run.id, this.seedIdentity(input));
    void this.store
      .createRun({
        id: run.id,
        sessionId: run.sessionId,
        participantId: run.participantId,
        homeConversationId: run.homeConversationId,
        ingress: run.ingress,
        externalId: run.externalId,
        cursor: run.cursor,
      })
      .catch((err) => console.error("[runs] createRun failed:", err));
    return run;
  }

  /** The Run a participant currently has open, if any. */
  current(sessionId: string, participantId: string): Run | undefined {
    return this.byParticipant.get(keyFor(sessionId, participantId));
  }

  /**
   * A human's prompt opens a Run as its whole identity set; a relay opens it
   * with the set it carried. Any other wake acts for nobody: a participant's
   * earlier Runs lend it no one.
   */
  private seedIdentity(input: OpenRunInput): RunIdentity {
    if (input.audienceParticipantId) {
      return {
        participants: [input.audienceParticipantId],
        delegation: input.delegation,
      };
    }
    const participants = [...(input.audienceParticipants ?? [])];
    return {
      participants,
      delegation: participants.length > 0 ? input.delegation : undefined,
    };
  }

  private openIdentity(
    sessionId: string,
    participantId: string,
  ): RunIdentity | undefined {
    const run = this.current(sessionId, participantId);
    return run && this.identityByRun.get(run.id);
  }

  /**
   * The delegation the participant's open Run acts under, if any. It is a
   * property of that Run alone: the next wake inherits the participants but
   * never the grant.
   */
  delegationFor(
    sessionId: string,
    participantId: string,
  ): RunDelegation | undefined {
    return this.openIdentity(sessionId, participantId)?.delegation;
  }

  /**
   * Adds a human who wrote into a Run already in flight (a steer or follow-up)
   * to its identity set, as the most recent member. A member who writes again
   * moves to the end rather than appearing twice. Nothing to join when the
   * participant is idle: the message opens a Run instead.
   */
  join(sessionId: string, participantId: string, humanId: string): void {
    const identity = this.openIdentity(sessionId, participantId);
    if (!identity) return;
    identity.participants = [
      ...identity.participants.filter((id) => id !== humanId),
      humanId,
    ];
  }

  /**
   * Clears the delegation from any open Run of the session acting under
   * `triggerId`'s grant, once the backend stopped honouring it. The Run keeps
   * its identity set, so the rest of the turn acts with the creator's live
   * assertion or, failing that, as the instance.
   */
  dropDelegation(sessionId: string, triggerId: string): void {
    for (const run of this.byParticipant.values()) {
      if (run.sessionId !== sessionId) continue;
      const identity = this.identityByRun.get(run.id);
      if (identity?.delegation?.triggerId === triggerId) {
        identity.delegation = undefined;
      }
    }
  }

  /**
   * The humans this participant's open Run is working for, oldest first.
   * Empty between Runs, and for a Run no human stands behind.
   */
  participantsFor(sessionId: string, participantId: string): string[] {
    return [
      ...(this.openIdentity(sessionId, participantId)?.participants ?? []),
    ];
  }

  /**
   * The human whose prompt this participant is acting for: the most recent
   * member of its open Run's identity set. Undefined when there is none.
   */
  audienceFor(sessionId: string, participantId: string): string | undefined {
    return this.participantsFor(sessionId, participantId).at(-1);
  }

  /** An open Run by id. Settled Runs live only in the store. */
  get(runId: RunId): Run | undefined {
    return this.byId.get(runId);
  }

  /**
   * Every Run a session currently has open, for the workflow view (unified-model
   * §9.8, "open Runs"). In-memory is authoritative for what is running now; a
   * settled Run lives only in the store, so this lists the live ones.
   */
  listForSession(sessionId: string): Run[] {
    const open: Run[] = [];
    for (const run of this.byParticipant.values()) {
      if (run.sessionId === sessionId) open.push(run);
    }
    return open;
  }

  /** Settles a Run, recording which terminal state it reached. */
  settle(runId: RunId, status: SettledStatus): void {
    const run = this.byId.get(runId);
    if (!run) return;
    this.finish(run, status, { superseded: false });
  }

  private finish(
    run: Run,
    status: SettledStatus,
    settlement: Settlement,
  ): void {
    this.forget(run);
    // Stamp the terminal status on the object handed to the listener, so a
    // `failed` Run is distinguishable from a clean one there (the store write
    // follows behind). After `forget`, the participant already reads idle.
    run.status = status;
    run.endedAt = new Date().toISOString();
    this.persist(run.id, { status, endedAt: run.endedAt });
    this.onSettled?.(run, settlement);
  }

  /** Settles the Run a participant has open, if it has one. */
  settleOpenFor(
    sessionId: string,
    participantId: string,
    status: SettledStatus,
  ): void {
    const run = this.current(sessionId, participantId);
    if (!run) return;
    this.settle(run.id, status);
  }

  /** Records a connector's resume cursor against an open Run. */
  setCursor(runId: RunId, cursor: string): void {
    const run = this.byId.get(runId);
    if (!run) return;
    run.cursor = cursor;
    this.persist(runId, { cursor });
  }

  /** Records the far side's own id against an open Run. */
  setExternalId(runId: RunId, externalId: string): void {
    const run = this.byId.get(runId);
    if (!run) return;
    run.externalId = externalId;
    this.persist(runId, { externalId });
  }

  /**
   * Settles every row the store still has marked `running`. Called once at
   * startup: nothing can be running before the process starts, so such a row is
   * a previous process's Run that never got to settle.
   */
  async failStaleRuns(): Promise<number> {
    return this.store.failStaleRuns();
  }

  /** Drops a Run from both indexes. */
  private forget(run: Run): void {
    this.byId.delete(run.id);
    this.identityByRun.delete(run.id);
    const key = keyFor(run.sessionId, run.participantId);
    if (this.byParticipant.get(key)?.id === run.id) {
      this.byParticipant.delete(key);
    }
  }

  /** Write-through persistence; a failed write must not break a stream. */
  private persist(
    runId: RunId,
    input: Parameters<RunStore["updateRun"]>[1],
  ): void {
    void this.store
      .updateRun(runId, input)
      .catch((err) => console.error("[runs] updateRun failed:", err));
  }
}
