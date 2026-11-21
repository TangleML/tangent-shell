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
   * them. Absent for an agent/automation wake, which inherits the participant's
   * last identity set instead.
   */
  audienceParticipantId?: string;
}

/**
 * The humans behind a participant's current work, oldest first. The most
 * recent is the acting default: the one a remote tool routes to and an egress
 * call acts for unless another member is named.
 */
export interface RunIdentity {
  participants: string[];
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
  /** Each participant's identity set, by `(session, participant)`. Kept across
   * Runs so an agent/automation wake inherits it rather than routing to nobody. */
  private readonly identities = new Map<string, RunIdentity>();
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
    this.stampAudience(
      input.sessionId,
      input.participantId,
      input.audienceParticipantId,
    );

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
   * Records the human whose prompt opens this Run as its whole identity set. An
   * agent/automation wake (no audience) keeps the participant's last set, so a
   * follow-on turn still acts for the same people.
   */
  private stampAudience(
    sessionId: string,
    participantId: string,
    audienceParticipantId: string | undefined,
  ): void {
    if (!audienceParticipantId) return;
    this.identities.set(keyFor(sessionId, participantId), {
      participants: [audienceParticipantId],
    });
  }

  /**
   * Adds a human who wrote into a Run already in flight (a steer or follow-up)
   * to its identity set, as the most recent member. A member who writes again
   * moves to the end rather than appearing twice.
   */
  join(sessionId: string, participantId: string, humanId: string): void {
    const key = keyFor(sessionId, participantId);
    const current = this.identities.get(key)?.participants ?? [];
    this.identities.set(key, {
      participants: [...current.filter((id) => id !== humanId), humanId],
    });
  }

  /**
   * Seeds a participant's identity set without opening a Run — used when a
   * sub-agent inherits the set of whoever asked Prime to spawn it, so its first
   * turn already acts for those people.
   */
  recordAudience(
    sessionId: string,
    participantId: string,
    participants: readonly string[],
  ): void {
    if (participants.length === 0) return;
    this.identities.set(keyFor(sessionId, participantId), {
      participants: [...participants],
    });
  }

  /**
   * The humans this participant is working for, oldest first; empty when no
   * human has ever woken it.
   */
  participantsFor(sessionId: string, participantId: string): string[] {
    return [
      ...(this.identities.get(keyFor(sessionId, participantId))?.participants ??
        []),
    ];
  }

  /**
   * The human whose prompt this participant is acting for: the most recent
   * member of its identity set. Undefined when no human has ever woken it.
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
