import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The two ends of a peer conversation, used to key a message's origin. */
export type PeerOrigin = "parent" | "agent";

/** One message carried between the launcher and the attached ACP agent. */
export interface PeerMessage {
  text: string;
}

interface Waiter {
  resolve: (message: PeerMessage | undefined) => void;
  settled: boolean;
}

/**
 * An in-process mailbox with one queue per origin: the launcher's messages wait
 * under `parent`, the agent's under `agent`. A {@link send} either hands the
 * message to a pending {@link take} or queues it; the bridge, the agent's MCP
 * tools, and the launcher's CLI all meet here, the last two across a socket.
 *
 * `take` consumes the oldest message (or resolves `undefined` on timeout or
 * abort); {@link signal} only observes the next arrival without consuming it, so
 * the bridge can wait for a parent message without stealing it from the agent.
 */
export class PeerMailbox {
  private readonly queues: Record<PeerOrigin, PeerMessage[]> = {
    parent: [],
    agent: [],
  };
  private readonly waiters: Record<PeerOrigin, Waiter[]> = {
    parent: [],
    agent: [],
  };
  private readonly sent: Record<PeerOrigin, number> = { parent: 0, agent: 0 };
  private notifier: Record<PeerOrigin, (() => void) | undefined> = {
    parent: undefined,
    agent: undefined,
  };
  private pending: Record<PeerOrigin, Promise<void> | undefined> = {
    parent: undefined,
    agent: undefined,
  };

  /** Queues a message for `origin`, waking a waiter if one is parked. */
  send(origin: PeerOrigin, text: string): void {
    this.sent[origin] += 1;
    const message: PeerMessage = { text };
    const waiter = this.waiters[origin].shift();
    if (waiter) waiter.resolve(message);
    else this.queues[origin].push(message);
    this.notify(origin);
  }

  /** How many messages have been sent for `origin`, over the mailbox's life. */
  sentCount(origin: PeerOrigin): number {
    return this.sent[origin];
  }

  /** The oldest queued message for `origin`, or undefined if none is waiting. */
  tryTake(origin: PeerOrigin): PeerMessage | undefined {
    return this.queues[origin].shift();
  }

  /** Consumes the next message for `origin`, or resolves on timeout/abort. */
  take(
    origin: PeerOrigin,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<PeerMessage | undefined> {
    const queued = this.queues[origin].shift();
    if (queued) return Promise.resolve(queued);
    if (signal?.aborted) return Promise.resolve(undefined);
    return new Promise((resolve) =>
      this.park(origin, timeoutMs, signal, resolve),
    );
  }

  /** Resolves once the next message for `origin` arrives, without taking it. */
  signal(origin: PeerOrigin): Promise<void> {
    const existing = this.pending[origin];
    if (existing) return existing;
    const created = new Promise<void>((resolve) => {
      this.notifier[origin] = resolve;
    });
    this.pending[origin] = created;
    return created;
  }

  private park(
    origin: PeerOrigin,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    resolve: (message: PeerMessage | undefined) => void,
  ): void {
    const waiter: Waiter = { settled: false, resolve: () => {} };
    const finish = (message: PeerMessage | undefined): void => {
      if (waiter.settled) return;
      waiter.settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      this.drop(origin, waiter);
      resolve(message);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    const onAbort = (): void => finish(undefined);
    waiter.resolve = finish;
    signal?.addEventListener("abort", onAbort, { once: true });
    this.waiters[origin].push(waiter);
  }

  private drop(origin: PeerOrigin, waiter: Waiter): void {
    const list = this.waiters[origin];
    const index = list.indexOf(waiter);
    if (index >= 0) list.splice(index, 1);
  }

  private notify(origin: PeerOrigin): void {
    const resolve = this.notifier[origin];
    this.notifier[origin] = undefined;
    this.pending[origin] = undefined;
    resolve?.();
  }
}

/**
 * The Unix socket a session's mailbox listens on. The session id is hashed to a
 * short, filesystem-safe name so the path stays under the OS socket-length cap
 * even when `$TMPDIR` is long.
 */
export function peerSocketPath(sessionId: string): string {
  const digest = createHash("sha1")
    .update(sessionId)
    .digest("hex")
    .slice(0, 16);
  return join(tmpdir(), "tangent-acp-attach", `${digest}.sock`);
}
