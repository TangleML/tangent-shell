/** How long a client may go without an HTTP request before the proxy-stamped identity is considered stale. */
export const IDENTITY_REFRESH_AFTER_MS = 30 * 60 * 1000;

/**
 * Tracks when a client last made an HTTP request, so it knows when a cheap
 * request is due before it sends a chat message: the front proxy restamps the
 * participant's identity on HTTP, not on an open socket.
 */
export class IdentityFreshness {
  private lastRequestAt: number | null = null;
  private readonly maxAgeMs: number;

  constructor(maxAgeMs: number = IDENTITY_REFRESH_AFTER_MS) {
    this.maxAgeMs = maxAgeMs;
  }

  noteRequest(now: number = Date.now()): void {
    this.lastRequestAt = now;
  }

  isStale(now: number = Date.now()): boolean {
    if (this.lastRequestAt === null) return true;
    return now - this.lastRequestAt >= this.maxAgeMs;
  }
}
