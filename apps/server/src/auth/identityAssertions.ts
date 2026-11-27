import type { IncomingHttpHeaders } from "node:http";

import type { NextFunction, Request, Response } from "express";

import {
  decodeJwtPayload,
  type IdentitySource,
  type ResolvedIdentity,
  resolveIdentity,
} from "./identity.ts";
import { normalizeEmail } from "./permissions.ts";

/** The sources whose token the backend will accept as a participant assertion. */
export type AssertingSource = Extract<
  IdentitySource,
  "trusted-header" | "bearer"
>;

/** The latest identity assertion seen for one participant. */
export interface IdentityAssertion {
  token: string;
  expiresAt?: Date;
  source: AssertingSource;
}

/**
 * The longest a bearer token may still have to live to be recorded: the
 * backend mints assertions for an hour, so anything further out is not one.
 */
const BEARER_MAX_REMAINING_MS = 65 * 60 * 1000;

/** The source a trusting front proxy stamps; recorded from any request. */
export const PROXY_ASSERTED: readonly AssertingSource[] = ["trusted-header"];

/** The source a client carries itself; recorded only once it passed a gate. */
export const CLIENT_ASSERTED: readonly AssertingSource[] = ["bearer"];

function isAssertingSource(source: IdentitySource): source is AssertingSource {
  return source === "trusted-header" || source === "bearer";
}

function expiryOf(token: string): Date | undefined {
  const exp = decodeJwtPayload(token)?.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return undefined;
  return new Date(exp * 1000);
}

function outranks(
  held: IdentityAssertion,
  incoming: IdentityAssertion,
): boolean {
  if (held.source !== incoming.source) {
    return held.source === "trusted-header";
  }
  return Boolean(
    held.expiresAt && incoming.expiresAt && incoming.expiresAt < held.expiresAt,
  );
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

  /**
   * Remembers `token` for `email`. The source ranks first: one the front proxy
   * asserted replaces a bearer token and is never replaced by one, whatever
   * their expiries. Within a source no token replaces one that outlives it: an
   * embed host re-sending an older token must not shorten what the server can
   * act with.
   */
  record(email: string, token: string, source: AssertingSource): void {
    this.sweep();
    const expiresAt = expiryOf(token);
    if (!this.admits(expiresAt, source)) return;
    const key = normalizeEmail(email);
    const held = this.byEmail.get(key);
    if (held && outranks(held, { token, expiresAt, source })) return;
    this.byEmail.set(key, { token, expiresAt, source });
  }

  /**
   * Whether a token with this expiry may be held. One already expired never
   * is. A bearer token, which a client chose to send, must also say when it
   * expires and expire within the hour the backend mints assertions for:
   * without that bound a forged or unrelated token would sit in the cache for
   * as long as the process runs, under whatever email it claims.
   */
  private admits(
    expiresAt: Date | undefined,
    source: AssertingSource,
  ): boolean {
    const now = this.now().getTime();
    if (expiresAt && expiresAt.getTime() <= now) return false;
    if (source !== "bearer") return true;
    return (
      expiresAt !== undefined &&
      expiresAt.getTime() - now <= BEARER_MAX_REMAINING_MS
    );
  }

  /**
   * Remembers a resolved identity when its source is one the backend verifies
   * and one of the sources this call accepts.
   */
  recordResolved(
    resolved: ResolvedIdentity | null,
    accept: readonly AssertingSource[],
  ): void {
    if (!resolved || !isAssertingSource(resolved.source)) return;
    if (!accept.includes(resolved.source)) return;
    this.record(resolved.identity.email, resolved.token, resolved.source);
  }

  /** Forgets `email`'s assertion, e.g. once the backend has refused it. */
  evict(email: string): void {
    this.byEmail.delete(normalizeEmail(email));
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

/**
 * Feeds the cache from one request's or handshake's headers, taking only the
 * sources named. A proxy-stamped assertion can be taken from any request; a
 * bearer only from one that passed an access gate, so the email it claims is
 * one this server has already acted on.
 */
export function rememberAssertion(
  headers: IncomingHttpHeaders,
  accept: readonly AssertingSource[],
  cache: IdentityAssertionCache = identityAssertions,
): void {
  cache.recordResolved(resolveIdentity(headers), accept);
}

/**
 * Express middleware that records the proxy-stamped assertion of every request
 * it sees. It runs before any route, so it takes nothing a client sent itself.
 */
export function rememberIdentityAssertion(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  rememberAssertion(req.headers, PROXY_ASSERTED);
  next();
}
