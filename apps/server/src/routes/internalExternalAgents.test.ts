import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir and pin the internal token before
// importing modules that read config at load time.
const ROOT = mkdtempSync(path.join(tmpdir(), "internal-external-agents-"));
process.env.SESSIONS_ROOT = ROOT;
process.env.TANGENT_INTERNAL_TOKEN = "internal-test-secret";

const express = (await import("express")).default;
const { createInternalExternalAgentsRouter } =
  await import("./internalExternalAgents.ts");
const { ExternalSubagentGateway } =
  await import("../external/externalSubagentGateway.ts");
const { RelayRegistry } = await import("../mcp/relayRegistry.ts");
const { RunRegistry } = await import("../runs/runRegistry.ts");
const { InMemoryRunStore } = await import("../store/inMemoryRunStore.ts");
const { InMemorySessionStore } =
  await import("../store/inMemorySessionStore.ts");
const { InMemoryParticipantStore } =
  await import("../store/inMemoryParticipantStore.ts");

import type { ConversationEventSink } from "../pi/types.ts";

const TOKEN = "internal-test-secret";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

/** A running internal external-agents API over a fresh gateway. */
function serve() {
  const sink: ConversationEventSink = {
    onAgentEvent: () => {},
    onSubagentUpdate: () => {},
    onAgentMessage: () => {},
    onSessionStatus: () => {},
  };
  const gateway = new ExternalSubagentGateway(
    sink,
    new RunRegistry(new InMemoryRunStore()),
    new InMemorySessionStore(new InMemoryParticipantStore()),
    new RelayRegistry(),
  );
  const app = express();
  app.use(express.json());
  app.use(
    "/internal/external-agents",
    createInternalExternalAgentsRouter(gateway),
  );
  const server = app.listen(0);
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}/internal/external-agents`, gateway };
}

/** Starts a `/deliveries` poll for one agent. */
function poll(
  base: string,
  agentId: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${base}/deliveries`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ sessionId: "s1", agentId }),
    signal,
  });
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Regression: aborting on `req.on("close")` answered every poll empty right
// after its body was read (Node 24 / Express 5), so drivers spun in a hot loop.
test("an empty internal deliveries poll holds until a delivery arrives", async () => {
  const { base, gateway } = serve();
  const agent = await gateway.register("s1", { name: "worker" });

  let answered = false;
  const pending = poll(base, agent.id).then((res) => {
    answered = true;
    return res;
  });
  await sleep(500);
  assert.equal(answered, false, "the poll must park, not answer empty");

  gateway.deliver("s1", agent.id, "wake up");
  const res = await pending;
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    deliveries: [{ agentId: agent.id, text: "wake up" }],
  });
});

test("a driver dropping a parked internal deliveries poll frees its waiter", async () => {
  const { base, gateway } = serve();
  const agent = await gateway.register("s1", { name: "worker" });

  const controller = new AbortController();
  const dropped = poll(base, agent.id, controller.signal).catch(
    (err: unknown) => err,
  );
  await sleep(300);
  controller.abort();
  assert.ok((await dropped) instanceof Error);
  await sleep(300);

  // Had the dropped poll's waiter lingered, it would swallow this delivery.
  gateway.deliver("s1", agent.id, "after the drop");
  const res = await poll(base, agent.id);
  assert.deepEqual(await res.json(), {
    deliveries: [{ agentId: agent.id, text: "after the drop" }],
  });
});
