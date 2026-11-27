import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import { RemoteRuns } from "./remoteRuns.ts";

const TARGET = { sessionId: "s1", agentId: "w1", homeConversationId: "c1" };

function makeRuns() {
  const runStore = new InMemoryRunStore();
  const runs = new RunRegistry(runStore);
  const remote = new RemoteRuns(runs);
  return {
    runs,
    remote,
    current: () => runs.current("s1", "w1"),
    statusOf: async (runId: string | undefined) =>
      runId ? (await runStore.getRun(runId))?.status : undefined,
    send: (audienceParticipantId?: string) =>
      remote.send(TARGET, { ingress: "reaction", audienceParticipantId }),
    answer: (promptId: string, disposition: "started" | "queued" | "handled") =>
      remote.apply(TARGET, {
        type: "prompt-answered",
        promptId,
        success: true,
        disposition,
      }),
    settle: (event: Partial<{ aborted: boolean; failed: boolean }> = {}) =>
      remote.apply(TARGET, {
        type: "settled",
        aborted: false,
        failed: false,
        ...event,
      }),
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("a host that never reports its runs keeps a Run per message", async () => {
  const h = makeRuns();
  const first = h.send();
  const second = h.send();

  assert.ok(first.runId && second.runId && first.runId !== second.runId);
  assert.equal(h.current()?.id, second.runId);
  await flush();
  assert.equal(await h.statusOf(first.runId), "completed");
});

test("a message sent mid-run joins the run in flight, which lasts until it settles", async () => {
  const h = makeRuns();
  const first = h.send();
  h.answer(first.promptId, "started");

  const steer = h.send();
  assert.equal(steer.runId, undefined, "no Run of its own");
  h.answer(steer.promptId, "queued");
  assert.equal(h.current()?.id, first.runId);

  h.settle();
  await flush();
  assert.equal(h.current(), undefined);
  assert.equal(await h.statusOf(first.runId), "completed");
});

test("a message the agent starts after its run settled opens its own Run", () => {
  const h = makeRuns();
  const first = h.send();
  h.answer(first.promptId, "started");
  const late = h.send("bob");
  h.settle();

  h.answer(late.promptId, "started");

  const run = h.current();
  assert.ok(run && run.id !== first.runId);
  assert.equal(h.runs.audienceFor("s1", "w1"), "bob");
});

test("an idle message the agent handles settles its Run and frees the agent", async () => {
  const h = makeRuns();
  const first = h.send();

  h.answer(first.promptId, "handled");

  await flush();
  assert.equal(await h.statusOf(first.runId), "completed");
  assert.ok(h.send().runId, "the next message finds the agent idle");
});

test("an idle message the agent rejects settles its Run as failed", async () => {
  const h = makeRuns();
  const error = mock.method(console, "error", () => {});
  const first = h.send();
  h.answer(first.promptId, "started");
  h.settle();
  const rejected = h.send();

  h.remote.apply(TARGET, {
    type: "prompt-answered",
    promptId: rejected.promptId,
    success: false,
    error: "nope",
  });
  error.mock.restore();

  await flush();
  assert.equal(await h.statusOf(rejected.runId), "failed");
  assert.equal(h.current(), undefined);
});

test("a settled run is cancelled when aborted and failed when its last call failed", async () => {
  const h = makeRuns();
  const aborted = h.send();
  h.answer(aborted.promptId, "started");
  h.settle({ aborted: true });
  const failed = h.send();
  h.answer(failed.promptId, "started");
  h.settle({ failed: true });

  await flush();
  assert.equal(await h.statusOf(aborted.runId), "cancelled");
  assert.equal(await h.statusOf(failed.runId), "failed");
});

test("events are attributed to the open Run once the host reports its runs", () => {
  const h = makeRuns();
  const first = h.send();
  assert.equal(h.remote.runIdFor("s1", "w1", "echoed"), "echoed");

  h.answer(first.promptId, "started");

  assert.equal(h.remote.runIdFor("s1", "w1", "echoed"), first.runId);
});
