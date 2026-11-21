import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IdentityAssertionCache,
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
  cache.record("Alice@X", jwt({ email: "alice@x", exp }));
  cache.record("alice@x", jwt({ email: "alice@x", exp: exp + 60 }));

  const held = cache.get("alice@x");
  assert.equal(held?.expiresAt?.toISOString(), "2026-01-01T13:01:00.000Z");
  assert.equal(held?.token, jwt({ email: "alice@x", exp: exp + 60 }));
  assert.equal(cache.get("ALICE@x")?.token, held?.token);
  assert.equal(cache.get("bob@x"), undefined);
});

test("an expired assertion is evicted, and one already expired is never kept", () => {
  const { cache, advance } = clockedCache();
  const exp = Math.floor(T0 / 1000) + 60;
  cache.record("alice@x", jwt({ email: "alice@x", exp }));
  cache.record("bob@x", jwt({ email: "bob@x", exp: exp - 120 }));

  assert.equal(cache.get("bob@x"), undefined);
  assert.ok(cache.get("alice@x"));
  advance(60_000);
  assert.equal(cache.get("alice@x"), undefined);
});

test("a token without exp is kept until a newer one replaces it", () => {
  const { cache, advance } = clockedCache();
  cache.record("alice@x", jwt({ email: "alice@x" }));
  advance(10 * 24 * 3600 * 1000);
  const held = cache.get("alice@x");
  assert.equal(held?.expiresAt, undefined);
  assert.equal(held?.token, jwt({ email: "alice@x" }));
});

test("only the trusted header and an accepted bearer feed the cache", () => {
  const cache = new IdentityAssertionCache();
  const token = jwt({
    email: "alice@x",
    exp: Math.floor(Date.now() / 1000) + 600,
  });

  cache.recordResolved({
    identity: { email: "alice@x", first_name: "", last_name: "" },
    token,
    source: "cookie",
  });
  assert.equal(cache.get("alice@x"), undefined);

  cache.recordResolved({
    identity: { email: "alice@x", first_name: "", last_name: "" },
    token,
    source: "auth-header",
  });
  assert.equal(cache.get("alice@x"), undefined);

  cache.recordResolved({
    identity: { email: "alice@x", first_name: "", last_name: "" },
    token,
    source: "bearer",
  });
  assert.equal(cache.get("alice@x")?.token, token);

  cache.recordResolved({
    identity: { email: "bob@x", first_name: "", last_name: "" },
    token: `${token}2`,
    source: "trusted-header",
  });
  assert.equal(cache.get("bob@x")?.token, `${token}2`);
  cache.recordResolved(null);
});

test("rememberAssertion reads a request's headers under the live configuration", () => {
  const cache = new IdentityAssertionCache();
  // With no trusted header and no embed origins configured in the test
  // process, a cookie identity resolves but is not an assertion.
  rememberAssertion({ cookie: `x=${jwt({ email: "alice@x" })}` }, cache);
  assert.equal(cache.get("alice@x"), undefined);
});
