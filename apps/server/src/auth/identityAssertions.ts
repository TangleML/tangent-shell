import type { IncomingHttpHeaders } from "node:http";

import type { NextFunction, Request, Response } from "express";

import {
  decodeJwtPayload,
  type IdentitySource,
  type ResolvedIdentity,
  resolveIdentity,
} from "./identity.ts";
import { normalizeEmail } from "./permissions.ts";

/** The latest identity assertion seen for one participant. */
export interface IdentityAssertion {
  token: string;
  expiresAt?: Date;
}

/** The sources whose token the backend will accept as a participant assertion. */
const ASSERTING_SOURCES: ReadonlySet<IdentitySource> = new Set([
  "trusted-header",
  "bearer",
]);

function expiryOf(token: string): Date | undefined {
  const exp = decodeJwtPayload(token)?.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return undefined;
  return new Date(exp * 1000);
}

/**
 * The most recent assertion each participant presented, so a call made on
 * their behalf later in a turn can carry it. Process-local and in memory: an
 * assertion is short-lived by construction, and nothing here outlives it.
 */
export class IdentityAssertionCache {
  private readonly byEmail = new Map<string, IdentityAssertion>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  /** Remembers `token` for `email`, replacing whatever was held. */
  record(email: string, token: string): void {
    this.sweep();
    const expiresAt = expiryOf(token);
    if (expiresAt && expiresAt <= this.now()) return;
    this.byEmail.set(normalizeEmail(email), { token, expiresAt });
  }

  /** Remembers a resolved identity when its source is one the backend verifies. */
  recordResolved(resolved: ResolvedIdentity | null): void {
    if (!resolved || !ASSERTING_SOURCES.has(resolved.source)) return;
    this.record(resolved.identity.email, resolved.token);
  }

  /** The live assertion for `email`, or `undefined` once it has expired. */
  get(email: string): IdentityAssertion | undefined {
    const key = normalizeEmail(email);
    const held = this.byEmail.get(key);
    if (!held) return undefined;
    if (held.expiresAt && held.expiresAt <= this.now()) {
      this.byEmail.delete(key);
      return undefined;
    }
    return held;
  }

  private sweep(): void {
    const now = this.now();
    for (const [email, held] of this.byEmail) {
      if (held.expiresAt && held.expiresAt <= now) this.byEmail.delete(email);
    }
  }
}

/** The one cache the HTTP and socket paths feed and the egress reads. */
export const identityAssertions = new IdentityAssertionCache();

/** Feeds the cache from one request's or handshake's headers. */
export function rememberAssertion(
  headers: IncomingHttpHeaders,
  cache: IdentityAssertionCache = identityAssertions,
): void {
  cache.recordResolved(resolveIdentity(headers));
}

/** Express middleware that feeds the cache from every request it sees. */
export function rememberIdentityAssertion(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  rememberAssertion(req.headers);
  next();
}
