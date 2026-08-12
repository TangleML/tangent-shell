import { randomBytes } from "node:crypto";

import type { CredentialScheme } from "@tangent/shared/contracts.ts";

import { A2A_TOKEN, INTERNAL_TOKEN, REMOTE_ENV_TOKEN } from "../config.ts";

/** Env var a spawned Pi child reads its inherited credential from. */
const INHERITED_TOKEN_VAR = "TANGENT_INTERNAL_TOKEN";

/** Bytes of entropy in a minted per-subject secret. */
const MINTED_SECRET_BYTES = 24;

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

/** External registrants: the same internal token, presented as a bearer. */
export const externalCredential = new BearerCredential(
  "internal-bearer",
  INTERNAL_TOKEN,
);

/** A2A peers: the outbound token Tangent presents when it dials one. */
export const a2aCredential = new PeerBearerCredential(A2A_TOKEN);
