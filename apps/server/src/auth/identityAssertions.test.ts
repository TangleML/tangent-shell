import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLIENT_ASSERTED,
  IdentityAssertionCache,
  PROXY_ASSERTED,
  rememberAssertion,
} from "./identityAssertions.ts";

function jwt(claims: Record<string, unknown>): string {
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `h.${segment(claims)}.sig`;
}

const T0 = Date.parse("2026-01-01T12:00:00Z");

/** A cache whose clock the test moves by hand. */
function clockedCache() {
  let now = T0;
  const cache = new IdentityAssertionCache(() => new Date(now));
  return { cache, advance: (ms: number) => (now += ms) };
}

test("the latest token per participant is kept, with its decoded expiry", () => {
  const { cache } = clockedCache();
  const exp = Math.floor(T0 / 1000) + 3600;
  cache.record("Alice@X", jwt({ email: "alice@x", exp }), "bearer");
  cache.record("alice@x", jwt({ email: "alice@x", exp: exp + 60 }), "bearer");

  const held = cache.get("alice@x");
  assert.equal(held?.expiresAt?.toISOString(), "2026-01-01T13:01:00.000Z");
  assert.equal(held?.token, jwt({ email: "alice@x", exp: exp + 60 }));
  assert.equal(cache.get("ALICE@x")?.token, held?.token);
  assert.equal(cache.get("bob@x"), undefined);
});

test("an expired assertion is evicted, and one already expired is never kept", () => {
  const { cache, advance } = clockedCache();
  const exp = Math.floor(T0 / 1000) + 60;
  cache.record("alice@x", jwt({ email: "alice@x", exp }), "bearer");
  cache.record("bob@x", jwt({ email: "bob@x", exp: exp - 120 }), "bearer");

  assert.equal(cache.get("bob@x"), undefined);
  assert.ok(cache.get("alice@x"));
  advance(60_000);
  assert.equal(cache.get("alice@x"), undefined);
});

test("a proxy-asserted token without exp is kept until a newer one replaces it", () => {
  const { cache, advance } = clockedCache();
  cache.record("alice@x", jwt({ email: "alice@x" }), "trusted-header");
  advance(10 * 24 * 3600 * 1000);
  const held = cache.get("alice@x");
  assert.equal(held?.expiresAt, undefined);
  assert.equal(held?.token, jwt({ email: "alice@x" }));
});

test("a bearer token is recorded only with an exp at most 65 minutes out", () => {
  const { cache } = clockedCache();
  const now = Math.floor(T0 / 1000);

  cache.record("alice@x", jwt({ email: "alice@x" }), "bearer");
  assert.equal(cache.get("alice@x"), undefined, "no exp");

  cache.record(
    "alice@x",
    jwt({ email: "alice@x", exp: now + 65 * 60 + 1 }),
    "bearer",
  );
  assert.equal(cache.get("alice@x"), undefined, "too far out");

  const admitted = jwt({ email: "alice@x", exp: now + 65 * 60 });
  cache.record("alice@x", admitted, "bearer");
  assert.equal(cache.get("alice@x")?.token, admitted);

  const far = jwt({ email: "bob@x", exp: now + 7 * 24 * 3600 });
  cache.record("bob@x", far, "trusted-header");
  assert.equal(cache.get("bob@x")?.token, far, "the proxy's bound is its own");
});

test("a bearer token never replaces one the trusted header asserted", () => {
  const { cache } = clockedCache();
  const exp = Math.floor(T0 / 1000) + 3600;
  const asserted = jwt({ email: "alice@x", exp });
  cache.record("alice@x", asserted, "trusted-header");

  cache.record("alice@x", jwt({ email: "alice@x", exp: exp + 3600 }), "bearer");
  assert.equal(cache.get("alice@x")?.token, asserted);
  assert.equal(cache.get("alice@x")?.source, "trusted-header");

  const reasserted = jwt({ email: "alice@x", exp: exp + 1 });
  cache.record("alice@x", reasserted, "trusted-header");
  assert.equal(cache.get("alice@x")?.token, reasserted);
});

test("a trusted-header token replaces a held bearer even when it expires earlier", () => {
  const { cache } = clockedCache();
  const exp = Math.floor(T0 / 1000) + 3600;
  cache.record("alice@x", jwt({ email: "alice@x", exp }), "bearer");

  const asserted = jwt({ email: "alice@x", exp: exp - 1800 });
  cache.record("alice@x", asserted, "trusted-header");
  assert.equal(cache.get("alice@x")?.token, asserted);
  assert.equal(cache.get("alice@x")?.source, "trusted-header");
});

test("a token expiring before the held one does not replace it", () => {
  const { cache, advance } = clockedCache();
  const exp = Math.floor(T0 / 1000) + 3600;
  const longer = jwt({ email: "alice@x", exp });
  cache.record("alice@x", longer, "bearer");

  cache.record("alice@x", jwt({ email: "alice@x", exp: exp - 60 }), "bearer");
  assert.equal(cache.get("alice@x")?.token, longer);

  cache.record("alice@x", jwt({ email: "alice@x", exp }), "bearer");
  assert.equal(cache.get("alice@x")?.token, longer);

  advance(3600_000);
  cache.record("alice@x", jwt({ email: "alice@x", exp: exp + 60 }), "bearer");
  assert.equal(
    cache.get("alice@x")?.token,
    jwt({ email: "alice@x", exp: exp + 60 }),
  );
});

test("evict forgets a participant's assertion", () => {
  const { cache } = clockedCache();
  cache.record("alice@x", jwt({ email: "alice@x" }), "trusted-header");

  cache.evict("ALICE@x");
  assert.equal(cache.get("alice@x"), undefined);
  cache.evict("nobody@x");
});

test("only the trusted header and an accepted bearer feed the cache", () => {
  const cache = new IdentityAssertionCache();
  const token = jwt({
    email: "alice@x",
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  const both = [...PROXY_ASSERTED, ...CLIENT_ASSERTED];

  cache.recordResolved(
    {
      identity: { email: "alice@x", first_name: "", last_name: "" },
      token,
      source: "cookie",
    },
    both,
  );
  assert.equal(cache.get("alice@x"), undefined);

  cache.recordResolved(
    {
      identity: { email: "alice@x", first_name: "", last_name: "" },
      token,
      source: "auth-header",
    },
    both,
  );
  assert.equal(cache.get("alice@x"), undefined);

  cache.recordResolved(
    {
      identity: { email: "alice@x", first_name: "", last_name: "" },
      token,
      source: "bearer",
    },
    both,
  );
  assert.equal(cache.get("alice@x")?.token, token);

  cache.recordResolved(
    {
      identity: { email: "bob@x", first_name: "", last_name: "" },
      token: `${token}2`,
      source: "trusted-header",
    },
    both,
  );
  assert.equal(cache.get("bob@x")?.token, `${token}2`);
  cache.recordResolved(null, both);
});

test("a bearer is taken only where the caller accepts client-asserted sources", () => {
  const cache = new IdentityAssertionCache();
  const token = jwt({
    email: "alice@x",
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  const bearer = {
    identity: { email: "alice@x", first_name: "", last_name: "" },
    token,
    source: "bearer" as const,
  };

  cache.recordResolved(bearer, PROXY_ASSERTED);
  assert.equal(cache.get("alice@x"), undefined, "pre-gate: not kept");

  cache.recordResolved(bearer, CLIENT_ASSERTED);
  assert.equal(cache.get("alice@x")?.token, token, "post-gate: kept");
});

test("rememberAssertion reads a request's headers under the live configuration", () => {
  const cache = new IdentityAssertionCache();
  // With no trusted header and no embed origins configured in the test
  // process, a cookie identity resolves but is not an assertion.
  rememberAssertion(
    { cookie: `x=${jwt({ email: "alice@x" })}` },
    [...PROXY_ASSERTED, ...CLIENT_ASSERTED],
    cache,
  );
  assert.equal(cache.get("alice@x"), undefined);
});
