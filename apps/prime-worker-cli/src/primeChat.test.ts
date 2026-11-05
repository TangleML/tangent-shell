import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, mock, test } from "node:test";

import { SocketEvents } from "@tangent/shared/contracts.ts";
import type { Socket } from "socket.io-client";

import { connectPrimeChat } from "./primeChat.ts";
import { RunTracker } from "./runTracker.ts";

const SESSION = "s1";
const PRIME_THREAD = "prime-thread";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

function setup() {
  // The fake plays both sides: the test emits what the Shell would send.
  const shell = new EventEmitter();
  const ended: string[] = [];
  const runs = new RunTracker(
    () => {},
    (reply) => ended.push(reply),
  );
  const chat = connectPrimeChat({
    socket: shell as unknown as Socket,
    sessionId: SESSION,
    runs,
    log: () => {},
    onReady: () => {},
  });
  shell.emit(SocketEvents.SubagentRoster, {
    sessionId: SESSION,
    subagents: [],
    primaryConversationId: PRIME_THREAD,
  });
  chat.send("hello");
  return { shell, ended, runs };
}

function primeMessage(id: string, content = "") {
  return { message: { id, conversationId: PRIME_THREAD, content } };
}

test("Prime's finished message ends the run once the status settles", () => {
  const { shell, ended } = setup();
  shell.emit(SocketEvents.SessionStatus, {
    sessionId: SESSION,
    status: "busy",
  });
  shell.emit(SocketEvents.AgentStart, primeMessage("m1"));
  shell.emit(SocketEvents.AgentEnd, primeMessage("m1", "Done."));
  shell.emit(SocketEvents.SessionStatus, {
    sessionId: SESSION,
    status: "active",
  });
  mock.timers.tick(1_500);
  assert.deepEqual(ended, ["Done."]);
});

test("an error from a sub-agent's message is ignored", () => {
  const { shell, ended, runs } = setup();
  shell.emit(SocketEvents.SessionStatus, {
    sessionId: SESSION,
    status: "busy",
  });
  shell.emit(SocketEvents.AgentStart, primeMessage("m1"));
  shell.emit(SocketEvents.AgentError, {
    sessionId: SESSION,
    messageId: "sub-1",
    message: "boom",
  });
  assert.deepEqual(ended, []);
  assert.equal(runs.isRunning, true);
});

test("a snapshot without this session means idle", () => {
  const { shell, ended } = setup();
  shell.emit(SocketEvents.SessionStatus, {
    sessionId: SESSION,
    status: "busy",
  });
  shell.emit(SocketEvents.SessionStatusSnapshot, { statuses: [] });
  mock.timers.tick(1_500);
  assert.equal(ended.length, 1);
});
