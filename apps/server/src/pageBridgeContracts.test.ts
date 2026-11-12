import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isPageBridgeMessage,
  isPageFilePath,
} from "@tangent/shared/contracts.ts";

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

test("accepts a fetch message", () => {
  assert.ok(
    isPageBridgeMessage({
      type: "tangent:fetch",
      requestId: "1",
      path: "/api/sessions/s/files/artifacts/data.json",
    }),
  );
});

test("rejects fetch with missing or wrong-typed fields", () => {
  assert.equal(
    isPageBridgeMessage({ type: "tangent:fetch", path: "/p" }),
    false,
  );
  assert.equal(
    isPageBridgeMessage({ type: "tangent:fetch", requestId: "1", path: 5 }),
    false,
  );
});

const FILES = "/api/sessions/s1/files";

test("a page may read files in its session's artifacts and uploads", () => {
  assert.ok(isPageFilePath("s1", `${FILES}/artifacts/workflow/data.json`));
  assert.ok(isPageFilePath("s1", `${FILES}/uploads/report%20(1).csv`));
});

test("a page may not read another session, route or folder", () => {
  const refused = [
    "/api/sessions/s2/files/artifacts/data.json",
    "/api/sessions/s1/participants",
    `${FILES}/MEMORY.md`,
    `${FILES}/.tangent/chats/prime.jsonl`,
    `${FILES}/artifacts`,
    `${FILES}/artifacts/`,
    `/proxy${FILES}/artifacts/data.json`,
    `https://elsewhere.example${FILES}/artifacts/data.json`,
  ];
  for (const path of refused) {
    assert.equal(isPageFilePath("s1", path), false, path);
  }
});

test("a page can't word a read so that it resolves somewhere else", () => {
  const refused = [
    `${FILES}/artifacts/../../participants`,
    `${FILES}/artifacts/%2e%2e/%2E%2E/participants`,
    `${FILES}/artifacts/..%2f..%2fparticipants`,
    `${FILES}/artifacts/a\\..\\..\\participants`,
    `${FILES}/artifacts/a%5c..%5cparticipants`,
    `${FILES}/artifacts/.\t./data.json`,
    `${FILES}/artifacts/data.json `,
    `${FILES}/artifacts/data.json?next=/api/me`,
    `${FILES}/artifacts/data.json#top`,
    `${FILES}/artifacts//data.json`,
    `${FILES}/artifacts/%zz.json`,
  ];
  for (const path of refused) {
    assert.equal(isPageFilePath("s1", path), false, path);
  }
});
