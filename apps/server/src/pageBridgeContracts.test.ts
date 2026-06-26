import assert from "node:assert/strict";
import { test } from "node:test";

import { isPageBridgeMessage } from "@tangent/shared/contracts.ts";

test("accepts a minimal callback message", () => {
  assert.ok(
    isPageBridgeMessage({
      type: "tangent:callback",
      requestId: "1",
      path: "/api/sessions/s/triggers/t/callback/abc",
    }),
  );
});

test("accepts a callback with body and encoding", () => {
  assert.ok(
    isPageBridgeMessage({
      type: "tangent:callback",
      requestId: "1",
      path: "/p",
      body: { name: "Mia", guests: "2" },
      encoding: "json",
    }),
  );
});

test("accepts an openUrl message", () => {
  assert.ok(isPageBridgeMessage({ type: "tangent:openUrl", url: "https://x" }));
});

test("rejects unknown and missing types", () => {
  assert.equal(isPageBridgeMessage({ type: "tangent:other" }), false);
  assert.equal(isPageBridgeMessage({}), false);
});

test("rejects callback with missing or wrong-typed fields", () => {
  assert.equal(
    isPageBridgeMessage({ type: "tangent:callback", path: "/p" }),
    false,
  );
  assert.equal(
    isPageBridgeMessage({ type: "tangent:callback", requestId: 1, path: "/p" }),
    false,
  );
  assert.equal(
    isPageBridgeMessage({
      type: "tangent:callback",
      requestId: "1",
      path: "/p",
      body: { n: 5 },
    }),
    false,
  );
  assert.equal(
    isPageBridgeMessage({
      type: "tangent:callback",
      requestId: "1",
      path: "/p",
      encoding: "xml",
    }),
    false,
  );
});

test("rejects openUrl without a string url", () => {
  assert.equal(isPageBridgeMessage({ type: "tangent:openUrl" }), false);
});

test("rejects non-object input", () => {
  assert.equal(isPageBridgeMessage(null), false);
  assert.equal(isPageBridgeMessage("x"), false);
  assert.equal(isPageBridgeMessage(undefined), false);
});
