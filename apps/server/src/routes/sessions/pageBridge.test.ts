import assert from "node:assert/strict";
import { test } from "node:test";

import { injectPageBridge } from "./pageBridge.ts";

test("injects the bridge before </head>", () => {
  const out = injectPageBridge(
    "<html><head><title>x</title></head><body></body></html>",
  );
  assert.match(out, /data-tangent-page-bridge/);
  assert.ok(out.indexOf("data-tangent-page-bridge") < out.indexOf("</head>"));
});

test("falls back to before </body> when there is no head", () => {
  const out = injectPageBridge("<body><p>hi</p></body>");
  assert.match(out, /data-tangent-page-bridge/);
  assert.ok(out.indexOf("data-tangent-page-bridge") < out.indexOf("</body>"));
});

test("prepends when neither head nor body is present", () => {
  const out = injectPageBridge("<p>fragment</p>");
  assert.ok(out.startsWith("<script data-tangent-page-bridge>"));
  assert.match(out, /<p>fragment<\/p>/);
});

test("is idempotent", () => {
  const once = injectPageBridge("<head></head>");
  const twice = injectPageBridge(once);
  assert.equal(once, twice);
  assert.equal(once.match(/data-tangent-page-bridge/g)?.length, 1);
});

test("matches </head> case-insensitively", () => {
  const out = injectPageBridge("<HEAD></HEAD>");
  assert.ok(out.indexOf("data-tangent-page-bridge") < out.indexOf("</HEAD>"));
});
