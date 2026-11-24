import assert from "node:assert/strict";
import { test } from "node:test";

import { type IdentityConfig, resolveIdentity } from "./identity.ts";

/** An unsigned JWT whose payload is `claims`; the server never checks the MAC. */
function jwt(claims: Record<string, unknown>): string {
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "HS256", typ: "JWT" })}.${segment(claims)}.sig`;
}

const TRUSTED = jwt({ email: "proxy@x", exp: 4_102_444_800 });
const BEARER = jwt({ email: "bearer@x", given_name: "Bea" });
const FORWARDED = jwt({ email: "forwarded@x" });
const COOKIE = jwt({ email: "cookie@x", family_name: "Crumb" });

const ALL_ON: IdentityConfig = {
  trustedHeader: "x-tangent-identity",
  bearerAllowed: true,
  authHeader: "x-auth-jwt",
  cookieName: "auth_token",
};

const EVERYTHING = {
  "x-tangent-identity": TRUSTED,
  authorization: `Bearer ${BEARER}`,
  "x-auth-jwt": FORWARDED,
  cookie: `other=1; auth_token=${COOKIE}`,
};

/** `EVERYTHING` minus the named headers. */
function without(...names: (keyof typeof EVERYTHING)[]) {
  const headers: Partial<typeof EVERYTHING> = { ...EVERYTHING };
  for (const name of names) delete headers[name];
  return headers;
}

test("the trusted header outranks every other source when configured", () => {
  const resolved = resolveIdentity(EVERYTHING, ALL_ON);
  assert.equal(resolved?.identity.email, "proxy@x");
  assert.equal(resolved?.source, "trusted-header");
  assert.equal(resolved?.token, TRUSTED);
});

test("an unconfigured trusted header is ignored even when a client sends one", () => {
  const resolved = resolveIdentity(EVERYTHING, {
    ...ALL_ON,
    trustedHeader: "",
  });
  assert.equal(resolved?.identity.email, "bearer@x");
  assert.equal(resolved?.source, "bearer");
  assert.equal(resolved?.identity.first_name, "Bea");
});

test("a bearer is honoured only when embed origins are configured", () => {
  const noTrusted = without("x-tangent-identity");

  const withEmbeds = resolveIdentity(noTrusted, {
    ...ALL_ON,
    trustedHeader: "",
    bearerAllowed: true,
  });
  assert.equal(withEmbeds?.source, "bearer");

  const withoutEmbeds = resolveIdentity(noTrusted, {
    ...ALL_ON,
    trustedHeader: "",
    bearerAllowed: false,
  });
  assert.equal(withoutEmbeds?.identity.email, "forwarded@x");
  assert.equal(withoutEmbeds?.source, "auth-header");
});

test("the forwarded auth header beats the cookie, and the cookie is last", () => {
  const config: IdentityConfig = {
    trustedHeader: "",
    bearerAllowed: false,
    authHeader: "x-auth-jwt",
    cookieName: "auth_token",
  };
  const headers = without("authorization");

  assert.equal(resolveIdentity(headers, config)?.source, "auth-header");

  const cookieOnly = resolveIdentity(
    { cookie: headers.cookie },
    { ...config, authHeader: "" },
  );
  assert.equal(cookieOnly?.identity.email, "cookie@x");
  assert.equal(cookieOnly?.identity.last_name, "Crumb");
  assert.equal(cookieOnly?.source, "cookie");

  assert.equal(
    resolveIdentity({ cookie: headers.cookie }, { ...config, cookieName: "" }),
    null,
  );
});

test("the highest-precedence source wins even when it is malformed or anonymous", () => {
  const anonymous = resolveIdentity(
    { ...EVERYTHING, "x-tangent-identity": jwt({ exp: 1 }) },
    ALL_ON,
  );
  assert.equal(
    anonymous,
    null,
    "a trusted header without a subject names nobody",
  );

  const garbage = resolveIdentity(
    { ...EVERYTHING, "x-tangent-identity": "not-a-jwt" },
    ALL_ON,
  );
  assert.equal(garbage, null);
});

test("sub stands in for email, and the default config follows the environment", () => {
  const resolved = resolveIdentity(
    { "x-tangent-identity": jwt({ sub: "sub@x" }) },
    ALL_ON,
  );
  assert.equal(resolved?.identity.email, "sub@x");

  // The test process sets no EMBED_ALLOWED_ORIGINS, so a bearer alone is not
  // an identity under the default configuration.
  assert.equal(resolveIdentity({ authorization: `Bearer ${BEARER}` }), null);
});

test("a token past its exp identifies nobody, and no lower source steps in", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  const expired = jwt({ email: "late@x", exp: now / 1000 - 1 });
  const live = jwt({ email: "live@x", exp: now / 1000 + 1 });

  assert.equal(
    resolveIdentity(
      { authorization: `Bearer ${expired}`, cookie: `auth_token=${COOKIE}` },
      ALL_ON,
      now,
    ),
    null,
  );
  assert.equal(
    resolveIdentity({ authorization: `Bearer ${live}` }, ALL_ON, now)?.identity
      .email,
    "live@x",
  );
  assert.equal(
    resolveIdentity({ authorization: `Bearer ${live}` }, ALL_ON, now + 1000),
    null,
    "exp is an instant, not a grace period",
  );
  assert.equal(
    resolveIdentity(
      { authorization: `Bearer ${jwt({ email: "odd@x", exp: "soon" })}` },
      ALL_ON,
      now,
    )?.identity.email,
    "odd@x",
    "an unreadable exp is ignored rather than treated as expired",
  );
});
