import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { CredentialScheme } from "@tangent/shared/contracts.ts";

import {
  A2A_TOKEN,
  INTERNAL_TOKEN,
  REMOTE_ENV_SIGNING_SECRET,
  REMOTE_ENV_TOKEN,
} from "../config.ts";

/** Env var a spawned Pi child reads its inherited credential from. */
const INHERITED_TOKEN_VAR = "TANGENT_INTERNAL_TOKEN";

/** Bytes of entropy in a minted per-subject secret. */
const MINTED_SECRET_BYTES = 24;

/** Prefix so a scoped token cannot collide with a raw shared-secret UUID. */
const SCOPED_TOKEN_PREFIX = "re1";

/** Lifetime of a minted scoped remote-env token. */
export const SCOPED_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * What a caller presented, whatever transport it arrived on. Both fields are
 * optional because a credential reads only the one its scheme uses — a socket
 * handshake carries no header, and an HTTP request carries no handshake.
 */
export interface CredentialPresentation {
  /** The HTTP `Authorization` header. */
  authorization?: string;
  /** The Socket.IO handshake's `auth.token`. */
  token?: string;
}

/**
 * How one connector proves who is talking to it. Credential is the thing that
 * varies per connector and nowhere else, so it sits beside the connector's
 * other facets rather than in a shared auth path each connector edits: adding
 * a connector means adding an implementation here, not widening a guard.
 *
 * An unconfigured credential authorizes nothing. That is the direction this
 * has to fail in — a server with no secret set must refuse every caller rather
 * than accept every caller.
 */
export interface ConnectorCredential {
  readonly scheme: CredentialScheme;
  /** Whether a secret is set at all. When false, {@link verify} is always false. */
  readonly configured: boolean;
  /** Whether what a caller presented authorizes it. */
  verify(presented: CredentialPresentation): boolean;
  /**
   * Environment a process the server spawns inherits the credential through.
   * Empty for every scheme that hands its secret over some other way.
   */
  spawnEnv(): Record<string, string>;
}

/** A shared secret presented as an HTTP `Authorization: Bearer` header. */
export class BearerCredential implements ConnectorCredential {
  readonly scheme: CredentialScheme;
  protected readonly token: string;

  constructor(scheme: CredentialScheme, token: string) {
    this.scheme = scheme;
    this.token = token;
  }

  get configured(): boolean {
    return this.token.length > 0;
  }

  verify(presented: CredentialPresentation): boolean {
    if (!this.configured) return false;
    return presented.authorization === `Bearer ${this.token}`;
  }

  spawnEnv(): Record<string, string> {
    return {};
  }
}

/**
 * The server's internal token as a Pi child receives it: handed down through
 * the child's environment at spawn, presented back as a bearer on the internal
 * API. Issuance is the only thing that separates it from
 * {@link externalCredential}, which checks the same secret from a caller that
 * already holds it.
 */
export class InheritedTokenCredential extends BearerCredential {
  constructor(token: string) {
    super("inherited-token", token);
  }

  override spawnEnv(): Record<string, string> {
    return { [INHERITED_TOKEN_VAR]: this.token };
  }
}

/**
 * A secret configured on both sides out of band and presented in a Socket.IO
 * handshake rather than a header — the remote environment's scheme.
 */
export class HandshakeTokenCredential implements ConnectorCredential {
  readonly scheme: CredentialScheme = "shared-token";
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  get configured(): boolean {
    return this.token.length > 0;
  }

  verify(presented: CredentialPresentation): boolean {
    if (!this.configured) return false;
    return presented.token === this.token;
  }

  spawnEnv(): Record<string, string> {
    return {};
  }
}

/** Claims encoded in a scoped remote-env token. */
export interface ScopedTokenClaims {
  scope: "remote-env";
  environmentId: string;
  sessionId: string;
  sub: string;
  iat: number;
  exp: number;
}

/** Inputs {@link ScopedTokenCredential.mint} signs into a token. */
export interface MintScopedTokenInput {
  environmentId: string;
  sessionId: string;
  sub: string;
}

/** A minted scoped token and the instant it stops verifying. */
export interface MintedScopedToken {
  token: string;
  expiresAt: string;
}

/** HMAC-SHA256 of `payload` using `secret`, encoded base64url. */
function scopedMac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Constant-time compare of two base64url MAC strings. */
function macEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Reads a non-empty string field, or `null`. */
function stringClaim(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (typeof value !== "string" || !value) return null;
  return value;
}

/** Reads a finite number field, or `null`. */
function unixClaim(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/** Narrows decoded JSON to an object record. */
function asRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) return null;
  return raw as Record<string, unknown>;
}

/** Reads the string claims of a scoped token payload. */
function readStringClaims(
  record: Record<string, unknown>,
): Pick<ScopedTokenClaims, "environmentId" | "sessionId" | "sub"> | null {
  if (record.scope !== "remote-env") return null;
  const environmentId = stringClaim(record, "environmentId");
  const sessionId = stringClaim(record, "sessionId");
  const sub = stringClaim(record, "sub");
  if (!environmentId || !sessionId || !sub) return null;
  return { environmentId, sessionId, sub };
}

/** Parses and validates the JSON claims object from a scoped token payload. */
function claimsFromUnknown(raw: unknown): ScopedTokenClaims | null {
  const record = asRecord(raw);
  if (!record) return null;
  const strings = readStringClaims(record);
  if (!strings) return null;
  const iat = unixClaim(record, "iat");
  const exp = unixClaim(record, "exp");
  if (iat === null || exp === null) return null;
  return { scope: "remote-env", ...strings, iat, exp };
}

/** Decodes a base64url payload segment into claims, or `null` if malformed. */
function decodeClaims(payload: string): ScopedTokenClaims | null {
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    return claimsFromUnknown(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

/** Splits a `re1.payload.mac` token into verified-shape segments. */
function splitScopedToken(
  token: string | undefined,
): { payload: string; mac: string } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [prefix, payload, mac] = parts;
  if (prefix !== SCOPED_TOKEN_PREFIX) return null;
  if (!payload || !mac) return null;
  return { payload, mac };
}

/** Drops claims that are missing or past `exp`. */
function liveClaims(
  claims: ScopedTokenClaims | null,
): ScopedTokenClaims | null {
  if (!claims) return null;
  if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
  return claims;
}

/**
 * A short-lived HMAC token minted for one embed host + session, presented in
 * the Socket.IO handshake. The gateway derives `environmentId` and `sessionId`
 * from the claims rather than trusting the handshake fields.
 */
export class ScopedTokenCredential implements ConnectorCredential {
  readonly scheme: CredentialScheme = "scoped-token";
  private readonly secret: string;
  private readonly ttlMs: number;

  constructor(secret: string, ttlMs: number = SCOPED_TOKEN_TTL_MS) {
    this.secret = secret;
    this.ttlMs = ttlMs;
  }

  get configured(): boolean {
    return this.secret.length > 0;
  }

  mint(input: MintScopedTokenInput): MintedScopedToken {
    if (!this.configured) {
      throw new Error("Scoped remote-env tokens are not configured.");
    }
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + Math.floor(this.ttlMs / 1000);
    const claims: ScopedTokenClaims = {
      scope: "remote-env",
      environmentId: input.environmentId,
      sessionId: input.sessionId,
      sub: input.sub,
      iat,
      exp,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const token = `${SCOPED_TOKEN_PREFIX}.${payload}.${scopedMac(payload, this.secret)}`;
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }

  parse(token: string | undefined): ScopedTokenClaims | null {
    if (!this.configured) return null;
    const parts = splitScopedToken(token);
    if (!parts) return null;
    if (!macEqual(parts.mac, scopedMac(parts.payload, this.secret)))
      return null;
    return liveClaims(decodeClaims(parts.payload));
  }

  verify(presented: CredentialPresentation): boolean {
    return this.parse(presented.token) !== null;
  }

  spawnEnv(): Record<string, string> {
    return {};
  }
}

/**
 * A secret minted for one subject rather than for the server: the peer is told
 * it when its channel is opened, and it opens nothing else. This is the scheme
 * that shapes the interface — the other three are per-server singletons, so
 * without this one a credential could have been a constant.
 */
export class MintedSecretCredential extends BearerCredential {
  constructor(secret: string) {
    super("minted-secret", secret);
  }

  /** The secret to hand the subject. Readable because it has to be told. */
  get secret(): string {
    return this.token;
  }
}

/** Mints a credential for one subject, with a fresh secret. */
export function mintSecretCredential(): MintedSecretCredential {
  return new MintedSecretCredential(
    randomBytes(MINTED_SECRET_BYTES).toString("hex"),
  );
}

/**
 * A secret Tangent presents to a far end that sits outside the trust domain,
 * rather than one a caller presents to Tangent. The direction is the whole
 * difference: {@link verify} refuses everything, because nothing inbound is an
 * A2A peer, and the secret leaves through {@link headers}.
 *
 * An unset secret means the peer asked for none, so it is not a lockout the way
 * it is for the inbound schemes — there is nobody to lock out.
 */
export class PeerBearerCredential implements ConnectorCredential {
  readonly scheme: CredentialScheme = "peer-bearer";
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  get configured(): boolean {
    return this.token.length > 0;
  }

  verify(): boolean {
    return false;
  }

  spawnEnv(): Record<string, string> {
    return {};
  }

  /**
   * Headers to send the peer. Concrete-only, like {@link
   * MintedSecretCredential.secret}: code holding the interface can check a
   * credential, never read one out.
   */
  headers(): Record<string, string> {
    if (!this.configured) return {};
    return { Authorization: `Bearer ${this.token}` };
  }
}

/**
 * The credential of a connector that authenticates nobody, for the null
 * connector. Declared rather than absent, like its `acceptsDelivery: false`:
 * an unclaimed participant has no far end to prove anything.
 */
export const deniedCredential: ConnectorCredential = {
  scheme: "none",
  configured: false,
  verify: () => false,
  spawnEnv: () => ({}),
};

/** Pi children: the internal token, inherited through the spawn environment. */
export const piCredential = new InheritedTokenCredential(INTERNAL_TOKEN);

/** Remote environments: the `REMOTE_ENV_TOKEN` handshake. */
export const remoteEnvCredential = new HandshakeTokenCredential(
  REMOTE_ENV_TOKEN,
);

/** Embed hosts: a per-session HMAC token minted by `POST /api/embed/remote-env-token`. */
export const scopedRemoteEnvCredential = new ScopedTokenCredential(
  REMOTE_ENV_SIGNING_SECRET,
);

/** External registrants: the same internal token, presented as a bearer. */
export const externalCredential = new BearerCredential(
  "internal-bearer",
  INTERNAL_TOKEN,
);

/** A2A peers: the outbound token Tangent presents when it dials one. */
export const a2aCredential = new PeerBearerCredential(A2A_TOKEN);
