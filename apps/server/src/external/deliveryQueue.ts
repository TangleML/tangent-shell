/** A message waiting to be carried to one external participant. */
export interface PendingDelivery {
  agentId: string;
  text: string;
}

/** A long-poll caller waiting for the session's next batch. */
interface Waiter {
  resolve: (deliveries: PendingDelivery[]) => void;
  timer: NodeJS.Timeout;
}

/**
 * The outbound half of the external connector: messages queued per session for
 * a driver that comes and asks for them, rather than a far end the server can
 * dial. A bundle tool holds the only route to its runtime, so the server hands
 * the work over on a long poll and the driver performs the last hop.
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
    const waiter = this.waiting.get(sessionId)?.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve([delivery]);
      return;
    }
    const queue = this.queued.get(sessionId);
    if (queue) queue.push(delivery);
    else this.queued.set(sessionId, [delivery]);
  }

  /**
   * Takes everything queued for the session, or waits up to `timeoutMs` for the
   * next delivery. Resolves empty on timeout, so a driver polls in a loop
   * without either spinning or holding a request open indefinitely.
   */
  take(sessionId: string, timeoutMs: number): Promise<PendingDelivery[]> {
    const queue = this.queued.get(sessionId);
    if (queue?.length) {
      this.queued.delete(sessionId);
      return Promise.resolve(queue);
    }

    return new Promise<PendingDelivery[]>((resolve) => {
      const timer = setTimeout(() => {
        this.forget(sessionId, waiter);
        resolve([]);
      }, timeoutMs);
      const waiter: Waiter = { resolve, timer };
      const waiters = this.waiting.get(sessionId);
      if (waiters) waiters.push(waiter);
      else this.waiting.set(sessionId, [waiter]);
    });
  }

  /** Discards one participant's queued work — its far end is gone. */
  drop(sessionId: string, agentId: string): void {
    const queue = this.queued.get(sessionId);
    if (!queue) return;
    const kept = queue.filter((delivery) => delivery.agentId !== agentId);
    if (kept.length) this.queued.set(sessionId, kept);
    else this.queued.delete(sessionId);
  }

  private forget(sessionId: string, waiter: Waiter): void {
    const waiters = this.waiting.get(sessionId);
    if (!waiters) return;
    const kept = waiters.filter((candidate) => candidate !== waiter);
    if (kept.length) this.waiting.set(sessionId, kept);
    else this.waiting.delete(sessionId);
  }
}
