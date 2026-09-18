import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so `createSession`'s mkdir never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "workflow-rest-"));
process.env.SESSIONS_ROOT = ROOT;

const express = (await import("express")).default;
const { Router } = await import("express");
const { registerWorkflowRoutes } = await import("./workflow.ts");
const { MembershipRegistry } =
  await import("../../conversation/membershipRegistry.ts");
const { ReactorRegistry } =
  await import("../../conversation/reactorRegistry.ts");
const { AdmissionEngine } = await import("../../conversation/admission.ts");
const { CorrelationEngine } = await import("../../conversation/correlation.ts");
const { ContextEngine } = await import("../../conversation/context.ts");
const { ResourceCatalog } =
  await import("../../conversation/resourceCatalog.ts");
const { RunRegistry } = await import("../../runs/runRegistry.ts");
const { InMemorySessionStore } =
  await import("../../store/inMemorySessionStore.ts");
const { InMemoryMembershipStore } =
  await import("../../store/inMemoryMembershipStore.ts");
const { InMemoryReactorStore } =
  await import("../../store/inMemoryReactorStore.ts");
const { InMemoryRunStore } = await import("../../store/inMemoryRunStore.ts");
const { InMemoryResourceStore } =
  await import("../../store/inMemoryResourceStore.ts");

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

/** A running express app mounting the workflow route over real in-memory engines. */
async function serve() {
  const store = new InMemorySessionStore();
  const membershipStore = new InMemoryMembershipStore();
  const memberships = new MembershipRegistry(
    store,
    membershipStore,
    () => true,
  );
  const reactors = new ReactorRegistry(new InMemoryReactorStore());
  const runs = new RunRegistry(new InMemoryRunStore());
  const admission = new AdmissionEngine(runs, () => ({ cancelled: true }));
  const correlations = new CorrelationEngine(runs);
  const context = new ContextEngine(
    new ResourceCatalog(new InMemoryResourceStore()),
  );

  const session = await store.createSession({ name: "S" });

  const app = express();
  app.use(express.json());
  const router = Router();
  registerWorkflowRoutes(router, {
    store,
    memberships,
    membershipStore,
    reactors,
    runs,
    admission,
    waves: { listWaves: () => [] },
    correlations,
    context,
  });
  app.use("/api/sessions", router);

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/sessions`;

  const get = async (pathname: string) => {
    const res = await fetch(`${base}${pathname}`);
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };

  return { get, sessionId: session.id };
}

test("GET workflow 404s an unknown session", async () => {
  const { get } = await serve();
  const { status, json } = await get("/nope/workflow");
  assert.equal(status, 404);
  assert.deepEqual(json, { error: "Session not found" });
});

test("GET workflow returns an empty-ish view on a fresh session", async () => {
  const { get, sessionId } = await serve();
  const { status, json } = await get(`/${sessionId}/workflow`);
  assert.equal(status, 200);
  assert.deepEqual(json.workflow, {
    memberships: [],
    reactors: [],
    runs: [],
    waves: [],
    correlations: [],
    digests: [],
    causes: [],
  });
});
