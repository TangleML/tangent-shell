import { randomUUID } from "node:crypto";

import type {
  ChatMessage,
  OutstandingCorrelation,
  RunId,
  TerminationCause,
} from "@tangent/shared/contracts.ts";

import type { RunRegistry } from "../runs/runRegistry.ts";
import { describeCause } from "./causes.ts";

/** How long a correlation is held open before it expires, unanswered. Matches
 * the ~25s an MCP `tools/call` can be held under the gateway's 30s cap, so the
 * connector's hold and the engine's policy expire together. */
const DEFAULT_TTL_MS = 25_000;

/** The outcome a {@link CorrelationEngine.waitFor} settles to. */
export type CorrelationOutcome =
  | { status: "answered"; message: ChatMessage }
  | { status: "timeout" };

/**
 * How the engine reads its own clock. Injected so a timeout is testable against
 * a fake clock rather than a real timer. Deliberately a private shape rather
 * than the Reactor's clock — the two policies are unrelated and should not share
 * a type that couples them.
 */
export interface CorrelationClock {
  now(): number;
  /** Runs `fn` at or after `atMs`; returns a cancel for the pending callback. */
  schedule(atMs: number, fn: () => void): () => void;
}

/** The real clock: `Date.now` and an unref'd `setTimeout` that never holds the
 * process open. */
export const systemCorrelationClock: CorrelationClock = {
  now: () => Date.now(),
  schedule: (atMs, fn) => {
    const timer = setTimeout(fn, Math.max(0, atMs - Date.now()));
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

/** Posts a system notice into a Conversation, matching the fan-out engine's:
 * the text plus the structured cause it describes. */
export type CorrelationNotify = (
  sessionId: string,
  conversationId: string,
  text: string,
  cause: TerminationCause,
) => void;

/** What opening a correlation requires. `id` is minted when a caller does not
 * supply one; `ttlMs` overrides the default hold. */
export interface OpenCorrelationInput {
  sessionId: string;
  conversationId: string;
  askedBy: string;
  askedOf?: string;
  id?: string;
  messageId?: string;
  runId?: RunId;
  ttlMs?: number;
}

type Waiter = (outcome: CorrelationOutcome) => void;

/** A tracked, opened correlation: its wire shape plus the waiters and timer the
 * engine holds for it. */
interface Entry {
  correlation: OutstandingCorrelation;
  sessionId: string;
  askedOf?: string;
  waiters: Waiter[];
  cancelTimer: () => void;
}

/** Waiters registered before their correlation was opened (subscribe-before-open),
 * each with its own fallback timer so a correlation that never opens still settles. */
interface Detached {
  waiters: { resolve: Waiter; cancelTimer: () => void }[];
}

/**
 * Holds the set of outstanding request/reply correlations (unified-model §9.4).
 * A Message carrying a `correlationId` opens one, keyed by the asking
 * participant's open {@link Run} when it has one; a Message whose `inReplyTo`
 * names it resolves it; and an unanswered one expires into a structured cause.
 *
 * This is the general fact `ask_prime` used to bury in a connector's private
 * table: any Participant can ask any other, "who is blocked on whom" is
 * listable, and the timeout is engine policy rather than a connector's silent
 * expiry. It does not make a question synchronous — a correlation promises an
 * answer will be *identifiable* when it arrives, not that one will arrive.
 */
export class CorrelationEngine {
  private readonly runs: RunRegistry;
  private readonly clock: CorrelationClock;
  private readonly outstanding = new Map<string, Entry>();
  private readonly detached = new Map<string, Detached>();
  private notify?: CorrelationNotify;

  constructor(
    runs: RunRegistry,
    clock: CorrelationClock = systemCorrelationClock,
  ) {
    this.runs = runs;
    this.clock = clock;
  }

  /**
   * Wires how a timeout surfaces. Separate from the constructor because the
   * notice is posted through the router that holds this engine: the cycle is in
   * the wiring, not the dependency.
   */
  useNotify(notify: CorrelationNotify): void {
    this.notify = notify;
  }

  /** Opens a correlation, idempotent on its id. */
  open(input: OpenCorrelationInput): OutstandingCorrelation {
    const id = input.id ?? randomUUID().replace(/-/g, "");
    const existing = this.outstanding.get(id);
    if (existing) return existing.correlation;

    const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
    const expiresAt = new Date(this.clock.now() + ttl).toISOString();
    const correlation: OutstandingCorrelation = {
      id,
      runId: input.runId,
      askedBy: input.askedBy,
      askedOf: input.askedOf,
      messageId: input.messageId,
      conversationId: input.conversationId,
      expiresAt,
    };
    const entry: Entry = {
      correlation,
      sessionId: input.sessionId,
      askedOf: input.askedOf,
      waiters: [],
      cancelTimer: this.clock.schedule(this.clock.now() + ttl, () =>
        this.expire(id),
      ),
    };

    const detached = this.detached.get(id);
    if (detached) {
      this.detached.delete(id);
      for (const waiter of detached.waiters) {
        waiter.cancelTimer();
        entry.waiters.push(waiter.resolve);
      }
    }
    this.outstanding.set(id, entry);
    return correlation;
  }

  /** Opens a correlation from a persisted Message that carries a `correlationId`.
   * Derives who asked (the author), who was asked (the first mention), and the
   * asking participant's open Run. No-op for a Message without one. */
  openFromMessage(message: ChatMessage): OutstandingCorrelation | undefined {
    if (!message.correlationId) return undefined;
    return this.open({
      id: message.correlationId,
      sessionId: message.sessionId,
      conversationId: message.conversationId,
      askedBy: message.author.id,
      askedOf: message.mentions[0],
      messageId: message.id,
      runId: this.runs.current(message.sessionId, message.author.id)?.id,
    });
  }

  /** Resolves the correlation a Message answers, if it names one that is
   * outstanding. Returns whether a correlation was resolved. */
  resolve(message: ChatMessage): boolean {
    const id = message.inReplyTo;
    if (!id) return false;

    const entry = this.outstanding.get(id);
    if (entry) {
      entry.cancelTimer();
      this.outstanding.delete(id);
      for (const waiter of entry.waiters) {
        waiter({ status: "answered", message });
      }
      return true;
    }

    const detached = this.detached.get(id);
    if (!detached) return false;
    this.detached.delete(id);
    for (const waiter of detached.waiters) {
      waiter.cancelTimer();
      waiter.resolve({ status: "answered", message });
    }
    return true;
  }

  /**
   * Waits for a correlation to be answered or to time out. This is how a
   * connector learns from the engine that its correlation resolved. A `waitFor`
   * before the correlation is opened is held with its own fallback timer, so a
   * correlation that never opens (an unowned relay channel posts no Message)
   * still settles rather than hanging.
   */
  waitFor(id: string, ttlMs = DEFAULT_TTL_MS): Promise<CorrelationOutcome> {
    return new Promise((resolve) => {
      const entry = this.outstanding.get(id);
      if (entry) {
        entry.waiters.push(resolve);
        return;
      }
      const detached = this.detached.get(id) ?? { waiters: [] };
      const cancelTimer = this.clock.schedule(this.clock.now() + ttlMs, () => {
        this.dropDetached(id, resolve);
        resolve({ status: "timeout" });
      });
      detached.waiters.push({ resolve, cancelTimer });
      this.detached.set(id, detached);
    });
  }

  /** The session's outstanding correlations. */
  listForSession(sessionId: string): OutstandingCorrelation[] {
    return [...this.outstanding.values()]
      .filter((entry) => entry.sessionId === sessionId)
      .map((entry) => entry.correlation);
  }

  /** The correlations a Run is still blocked on. */
  listForRun(runId: RunId): OutstandingCorrelation[] {
    return [...this.outstanding.values()]
      .filter((entry) => entry.correlation.runId === runId)
      .map((entry) => entry.correlation);
  }

  private expire(id: string): void {
    const entry = this.outstanding.get(id);
    if (!entry) return;
    this.outstanding.delete(id);
    for (const waiter of entry.waiters) {
      waiter({ status: "timeout" });
    }
    const cause: TerminationCause = {
      kind: "correlation-timeout",
      askedBy: entry.correlation.askedBy,
      askedOf: entry.askedOf,
      participantId: entry.correlation.askedBy,
      conversationId: entry.correlation.conversationId,
      runId: entry.correlation.runId,
      waveDepth: 0,
    };
    this.notify?.(
      entry.sessionId,
      entry.correlation.conversationId,
      describeCause(cause),
      cause,
    );
  }

  private dropDetached(id: string, resolve: Waiter): void {
    const detached = this.detached.get(id);
    if (!detached) return;
    detached.waiters = detached.waiters.filter(
      (waiter) => waiter.resolve !== resolve,
    );
    if (detached.waiters.length === 0) this.detached.delete(id);
  }
}
