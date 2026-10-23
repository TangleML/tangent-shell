/** A message waiting to be carried to one external participant. */
export interface PendingDelivery {
  agentId: string;
  text: string;
}

/** Scopes a take to one participant, and lets the caller abort a parked poll. */
export interface TakeOptions {
  /** When set, the take only sees (and parks for) this participant's work. */
  agentId?: string;
  /** Aborting resolves the parked poll empty and frees its waiter. */
  signal?: AbortSignal;
}

/** A long-poll caller waiting for the session's next batch. */
interface Waiter {
  sessionId: string;
  resolve: (deliveries: PendingDelivery[]) => void;
  timer: NodeJS.Timeout;
  /** When set, only a delivery for this participant may wake this waiter. */
  agentId?: string;
  /** Detaches the abort listener when the waiter settles. */
  cleanup: () => void;
  /** Guards against a second settle (e.g. a timeout racing an abort). */
  settled: boolean;
}

/**
 * The outbound half of the external connector: messages queued per session for
 * a driver that comes and asks for them, rather than a far end the server can
 * dial. A bundle tool holds the only route to its runtime, so the server hands
 * the work over on a long poll and the driver performs the last hop.
 *
 * A take may be scoped to one participant (`agentId`), so a driver that owns a
 * single agent — an ACP attach bridge — only ever sees its own work and never
 * another agent's. A take without an `agentId` collects the whole session, the
 * way a multi-agent bundle tool (which routes by `agentId` itself) expects.
 *
 * Queued work is answered immediately; an empty queue parks the caller until
 * something arrives or its budget runs out. State is in memory on purpose — a
 * wake the driver never collected is a wake for a runtime that is no longer
 * being driven.
 */
export class DeliveryQueue {
  private readonly queued = new Map<string, PendingDelivery[]>();
  private readonly waiting = new Map<string, Waiter[]>();

  /** Queues one delivery, handing it straight to a waiting driver if there is one. */
  push(sessionId: string, delivery: PendingDelivery): void {
    const waiter = this.takeWaiter(sessionId, delivery.agentId);
    if (waiter) {
      this.settle(waiter, [delivery]);
      return;
    }
    const queue = this.queued.get(sessionId);
    if (queue) queue.push(delivery);
    else this.queued.set(sessionId, [delivery]);
  }

  /**
   * Takes the session's queued work — everything, or only `agentId`'s when
   * scoped — or waits up to `timeoutMs` for the next matching delivery. Resolves
   * empty on timeout or abort, so a driver polls in a loop without either
   * spinning or holding a request open indefinitely.
   */
  take(
    sessionId: string,
    timeoutMs: number,
    options: TakeOptions = {},
  ): Promise<PendingDelivery[]> {
    const ready = this.drain(sessionId, options.agentId);
    if (ready.length) return Promise.resolve(ready);
    if (options.signal?.aborted) return Promise.resolve([]);

    return new Promise<PendingDelivery[]>((resolve) => {
      this.park(sessionId, timeoutMs, resolve, options);
    });
  }

  /**
   * Discards one participant's queued work and wakes any poll parked for it —
   * its far end is gone, so a wake left behind would be a promise the transport
   * cannot keep.
   */
  drop(sessionId: string, agentId: string): void {
    const queue = this.queued.get(sessionId);
    if (queue) {
      const kept = queue.filter((delivery) => delivery.agentId !== agentId);
      if (kept.length) this.queued.set(sessionId, kept);
      else this.queued.delete(sessionId);
    }
    for (const waiter of this.waitersFor(sessionId, agentId)) {
      this.settle(waiter, []);
    }
  }

  /** Removes and returns the session's deliveries for `agentId` (or all). */
  private drain(
    sessionId: string,
    agentId: string | undefined,
  ): PendingDelivery[] {
    const queue = this.queued.get(sessionId);
    if (!queue?.length) return [];
    if (!agentId) {
      this.queued.delete(sessionId);
      return queue;
    }
    const taken = queue.filter((delivery) => delivery.agentId === agentId);
    if (!taken.length) return [];
    const kept = queue.filter((delivery) => delivery.agentId !== agentId);
    if (kept.length) this.queued.set(sessionId, kept);
    else this.queued.delete(sessionId);
    return taken;
  }

  /** Parks a waiter until a matching delivery, the timeout, or an abort. */
  private park(
    sessionId: string,
    timeoutMs: number,
    resolve: (deliveries: PendingDelivery[]) => void,
    options: TakeOptions,
  ): void {
    const timer = setTimeout(() => this.settle(waiter, []), timeoutMs);
    const onAbort = (): void => this.settle(waiter, []);
    const waiter: Waiter = {
      sessionId,
      resolve,
      timer,
      agentId: options.agentId,
      cleanup: () => options.signal?.removeEventListener("abort", onAbort),
      settled: false,
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const waiters = this.waiting.get(sessionId);
    if (waiters) waiters.push(waiter);
    else this.waiting.set(sessionId, [waiter]);
  }

  /** Pulls the first waiter a delivery for `agentId` may wake, if any. */
  private takeWaiter(sessionId: string, agentId: string): Waiter | undefined {
    const waiters = this.waiting.get(sessionId);
    if (!waiters) return undefined;
    const index = waiters.findIndex(
      (waiter) => waiter.agentId === undefined || waiter.agentId === agentId,
    );
    if (index < 0) return undefined;
    const [waiter] = waiters.splice(index, 1);
    if (!waiters.length) this.waiting.delete(sessionId);
    return waiter;
  }

  /** The parked waiters bound to `agentId`, removed from the session's list. */
  private waitersFor(sessionId: string, agentId: string): Waiter[] {
    const waiters = this.waiting.get(sessionId);
    if (!waiters) return [];
    const matched = waiters.filter((waiter) => waiter.agentId === agentId);
    if (!matched.length) return [];
    const kept = waiters.filter((waiter) => waiter.agentId !== agentId);
    if (kept.length) this.waiting.set(sessionId, kept);
    else this.waiting.delete(sessionId);
    return matched;
  }

  /** Resolves a waiter once, clearing its timer, listener, and list slot. */
  private settle(waiter: Waiter, deliveries: PendingDelivery[]): void {
    if (waiter.settled) return;
    waiter.settled = true;
    clearTimeout(waiter.timer);
    waiter.cleanup();
    this.forget(waiter);
    waiter.resolve(deliveries);
  }

  /** Removes a waiter from its session's list, if still present. */
  private forget(waiter: Waiter): void {
    const waiters = this.waiting.get(waiter.sessionId);
    if (!waiters) return;
    const kept = waiters.filter((candidate) => candidate !== waiter);
    if (kept.length) this.waiting.set(waiter.sessionId, kept);
    else this.waiting.delete(waiter.sessionId);
  }
}
