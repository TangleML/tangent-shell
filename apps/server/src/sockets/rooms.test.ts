import assert from "node:assert/strict";
import { test } from "node:test";

import {
  messageRoomFor,
  roomFor,
  roomForConversation,
  SESSIONS_LOBBY,
} from "./rooms.ts";

test("a session's room and its per-Conversation rooms are distinct", () => {
  assert.equal(roomFor("s1"), "session:s1");
  assert.equal(roomForConversation("s1", "prime"), "conv:s1:prime");
  assert.notEqual(roomForConversation("s1", "prime"), roomFor("s1"));
  assert.notEqual(SESSIONS_LOBBY, roomFor("s1"));
});

test("a Conversation room is scoped by session id", () => {
  assert.notEqual(
    roomForConversation("s1", "prime"),
    roomForConversation("s2", "prime"),
  );
});

test("messageRoomFor delivers per Conversation", () => {
  assert.equal(
    messageRoomFor("s1", "sub-1"),
    roomForConversation("s1", "sub-1"),
  );
});
