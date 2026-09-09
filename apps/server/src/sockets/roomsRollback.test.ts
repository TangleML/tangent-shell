import assert from "node:assert/strict";
import { test } from "node:test";

// Node runs each test file in its own process, so setting the rollback flag
// here only affects this file. `rooms.ts` (via config) reads it at import, so it
// must be imported dynamically, after the env is set.
process.env.ROOM_PER_CONVERSATION = "0";

test("messageRoomFor falls back to the session room when rolled back", async () => {
  const { messageRoomFor, roomFor } = await import("./rooms.ts");
  assert.equal(messageRoomFor("s1", "sub-1"), roomFor("s1"));
});
