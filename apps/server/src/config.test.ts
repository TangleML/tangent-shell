import assert from "node:assert/strict";
import { test } from "node:test";

import { readHeaderName } from "./config.ts";

const VAR = "CONFIG_TEST_HEADER_NAME";

function withEnv<T>(value: string | undefined, run: () => T): T {
  const previous = process.env[VAR];
  if (value === undefined) delete process.env[VAR];
  else process.env[VAR] = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env[VAR];
    else process.env[VAR] = previous;
  }
}

test("readHeaderName lowercases and accepts any RFC 7230 token", () => {
  assert.equal(
    withEnv("X-Forwarded-User", () => readHeaderName(VAR)),
    "x-forwarded-user",
  );
  assert.equal(
    withEnv(" X_Trusted.Identity+1 ", () => readHeaderName(VAR)),
    "x_trusted.identity+1",
  );
  assert.equal(
    withEnv("!#$%&'*+.^_`|~", () => readHeaderName(VAR)),
    "!#$%&'*+.^_`|~",
  );
});

test("readHeaderName treats an unset or blank setting as off", () => {
  assert.equal(
    withEnv(undefined, () => readHeaderName(VAR)),
    "",
  );
  assert.equal(
    withEnv("   ", () => readHeaderName(VAR)),
    "",
  );
});

test("readHeaderName refuses separators and other non-token characters", () => {
  for (const bad of [
    "x identity",
    "x:identity",
    "x/identity",
    "x(id)",
    "héader",
    'x"y',
  ]) {
    assert.throws(
      () => withEnv(bad, () => readHeaderName(VAR)),
      new RegExp(`${VAR} must be a header name`),
      bad,
    );
  }
});
