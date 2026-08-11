import assert from "node:assert/strict";
import { test } from "node:test";

import { type MentionCandidate, resolveMentions } from "./mentions.ts";

const ROSTER: MentionCandidate[] = [
  { id: "prime", name: "Prime" },
  { id: "sub-1", name: "Worker One" },
  { id: "sub-2", name: "researcher" },
];

test("resolves a name to its participant id", () => {
  assert.deepEqual(resolveMentions("@Prime take a look", ROSTER), ["prime"]);
});

test("matches case-insensitively and ignores spacing in the name", () => {
  assert.deepEqual(resolveMentions("@workerone ping", ROSTER), ["sub-1"]);
  assert.deepEqual(resolveMentions("@RESEARCHER ping", ROSTER), ["sub-2"]);
});

test("an id can be mentioned directly", () => {
  assert.deepEqual(resolveMentions("@sub-1 status?", ROSTER), ["sub-1"]);
});

test("trailing punctuation belongs to the sentence, not the name", () => {
  assert.deepEqual(resolveMentions("thanks @Prime, and @sub-2!", ROSTER), [
    "prime",
    "sub-2",
  ]);
});

test("an unknown mention stays prose rather than becoming an id", () => {
  assert.deepEqual(resolveMentions("@nobody hello @Prime", ROSTER), ["prime"]);
});

test("a repeated mention is listed once, in first-mention order", () => {
  assert.deepEqual(
    resolveMentions("@sub-2 and @Prime and @sub-2 again", ROSTER),
    ["sub-2", "prime"],
  );
});

test("a message with no mentions resolves to nothing", () => {
  assert.deepEqual(resolveMentions("just a message", ROSTER), []);
  assert.deepEqual(resolveMentions("an email a@b.com", ROSTER), []);
});
