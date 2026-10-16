import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeShellUrl, parseSessionRef } from "./shellUrl.ts";

test("shell URLs drop a session path and trailing slash", () => {
  assert.equal(
    normalizeShellUrl("http://localhost:5173/sessions/abc?x=1"),
    "http://localhost:5173",
  );
  assert.equal(
    normalizeShellUrl("https://host/tangent/"),
    "https://host/tangent",
  );
  assert.throws(() => normalizeShellUrl("ftp://host"));
});

test("session refs accept a pasted URL or a raw id", () => {
  assert.equal(parseSessionRef("http://h/sessions/abc-123#chat"), "abc-123");
  assert.equal(parseSessionRef("  abc-123 "), "abc-123");
});
