import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { PeerMailbox, peerSocketPath } from "./peerMailbox.ts";
import {
  createPeerServer,
  peerSend,
  type PeerServer,
  peerWait,
} from "./peerSocket.ts";

const servers: PeerServer[] = [];
after(async () => {
  for (const server of servers) await server.close().catch(() => {});
});

async function serve(): Promise<{ path: string; mailbox: PeerMailbox }> {
  const path = peerSocketPath(randomUUID());
  const mailbox = new PeerMailbox();
  servers.push(await createPeerServer(path, mailbox));
  return { path, mailbox };
}

test("send hands a message to a waiter on the same origin", async () => {
  const mailbox = new PeerMailbox();
  const waiting = mailbox.take("parent", 1_000);
  mailbox.send("parent", "hi");
  assert.deepEqual(await waiting, { text: "hi" });
});

test("take drains a queued message without waiting", async () => {
  const mailbox = new PeerMailbox();
  mailbox.send("agent", "queued");
  assert.deepEqual(await mailbox.take("agent", 10), { text: "queued" });
});

test("take resolves undefined when nothing arrives in time", async () => {
  const mailbox = new PeerMailbox();
  assert.equal(await mailbox.take("parent", 10), undefined);
});

test("signal observes the next message without consuming it", async () => {
  const mailbox = new PeerMailbox();
  const seen = mailbox.signal("parent");
  mailbox.send("parent", "peek");
  await seen;
  assert.deepEqual(mailbox.tryTake("parent"), { text: "peek" });
});

test("sentCount tracks each origin's sends", () => {
  const mailbox = new PeerMailbox();
  mailbox.send("agent", "a");
  mailbox.send("agent", "b");
  assert.equal(mailbox.sentCount("agent"), 2);
  assert.equal(mailbox.sentCount("parent"), 0);
});

test("a message crosses the socket from sender to waiter", async () => {
  const { path } = await serve();
  const waiting = peerWait(path, "parent", 1_000);
  assert.equal(await peerSend(path, "parent", "over the wire"), true);
  assert.deepEqual(await waiting, { text: "over the wire" });
});

test("a socket wait times out to undefined when nothing is queued", async () => {
  const { path } = await serve();
  assert.equal(await peerWait(path, "agent", 30), undefined);
});

test("a second server refuses to take over a live socket", async () => {
  const { path } = await serve();
  await assert.rejects(createPeerServer(path, new PeerMailbox()));
});
