import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { SYSTEM_AUTHOR } from "@tangent/shared/contracts.ts";
import type { Server } from "socket.io";

import {
  chooseEgressIdentity,
  ParticipantAssertionExpiredError,
} from "../../auth/egressIdentity.ts";
import { IdentityAssertionCache } from "../../auth/identityAssertions.ts";
import type {
  ConversationRouter,
  PostInput,
} from "../../conversation/conversationRouter.ts";
import { type RunDelegation, RunRegistry } from "../../runs/runRegistry.ts";
import { InMemoryRunStore } from "../../store/inMemoryRunStore.ts";
import { InMemoryTriggerDelegationStore } from "../../store/inMemoryTriggerDelegationStore.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import type { PiAgentManager, PrimeSpawnOptions } from "../piAgentManager.ts";
import { PRIME_AGENT_ID } from "../types.ts";
import { TriggerEngine } from "./triggerEngine.ts";
import { type StoredTrigger, TriggerManager } from "./triggerManager.ts";

const SESSION_ENV = { STUDIO_ENGINE_URL: "http://127.0.0.1:8100" };

function jwt(claims: Record<string, unknown>): string {
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `h.${segment(claims)}.sig`;
}
const ALICE = jwt({
  email: "alice@x",
  exp: Math.floor(Date.now() / 1000) + 600,
});

function engineFor(
  target: StoredTrigger["target"],
  identity: { participantId?: string; delegation?: RunDelegation } = {},
) {
  const ensured: PrimeSpawnOptions[] = [];
  const posted: PostInput[] = [];
  const stored = {
    id: "t1",
    name: "engine-step",
    kind: "callback",
    enabled: true,
    prompt: "{{body.prompt}}",
    target,
    participantId: identity.participantId,
    delegationId: identity.delegation && "d1",
  } as unknown as StoredTrigger;
  const store = {
    listAgents: async () => [],
    getSessionEnv: async () => SESSION_ENV,
    recordAgent: async () => undefined,
  } as unknown as SessionStore;
  const pi = {
    ensure: async (_id: string, _root: string, options: PrimeSpawnOptions) => {
      ensured.push(options);
    },
    hasAgent: () => true,
  } as unknown as PiAgentManager;
  const triggers = {
    listen: () => undefined,
    getStored: () => stored,
    delegationOf: () => identity.delegation,
    markFired: () => undefined,
    get: () => undefined,
  } as unknown as TriggerManager;
  const conversations = {
    post: async (input: PostInput) => {
      posted.push(input);
    },
  } as unknown as ConversationRouter;
  const engine = new TriggerEngine(
    {} as Server,
    store,
    pi,
    triggers,
    conversations,
  );
  return { engine, ensured, posted };
}

test("a Prime-target firing revives Prime with the session's env", async () => {
  const { engine, ensured } = engineFor({ type: "prime" });
  await engine.fire("s1", "/tmp/s1", "t1", { body: { prompt: "go" } });
  assert.deepEqual(ensured[0]?.env, SESSION_ENV);
});

test("a sub-agent-target firing revives Prime with the session's env", async () => {
  const { engine, ensured } = engineFor({
    type: "subagent",
    agentId: "a1",
    spec: { name: "worker" },
  } as StoredTrigger["target"]);
  await engine.fire("s1", "/tmp/s1", "t1", { body: { prompt: "go" } });
  assert.deepEqual(ensured[0]?.env, SESSION_ENV);
});

test("a firing's prompt carries the creator and the trigger's delegation, never the identity set", async () => {
  const delegation = {
    triggerId: "t1",
    participantId: "alice@x",
    token: "delegation-token",
  };
  const delegated = engineFor(
    { type: "subagent", agentId: "sub-1", spec: { name: "step" } },
    { participantId: "alice@x", delegation },
  );
  await delegated.engine.fire("s1", "/tmp/s1", "t1", {
    body: { prompt: "go" },
  });
  assert.equal(delegated.posted.length, 1);
  assert.equal(delegated.posted[0].audienceParticipantId, "alice@x");
  assert.deepEqual(delegated.posted[0].delegation, delegation);
  assert.deepEqual(delegated.posted[0].mentions, ["sub-1"]);

  const bound = engineFor({ type: "prime" }, { participantId: "alice@x" });
  await bound.engine.fire("s1", "/tmp/s1", "t1", { body: { prompt: "go" } });
  assert.equal(bound.posted[0].audienceParticipantId, "alice@x");
  assert.equal(bound.posted[0].delegation, undefined);

  const anonymous = engineFor({ type: "prime" });
  await anonymous.engine.fire("s1", "/tmp/s1", "t1", {
    body: { prompt: "go" },
  });
  assert.equal(anonymous.posted[0].audienceParticipantId, undefined);
  assert.equal(anonymous.posted[0].delegation, undefined);
});

/** An engine over a real manager, recording the delegations it revokes. */
function engineOver(triggers: TriggerManager) {
  const revoked: string[] = [];
  const engine = new TriggerEngine(
    { to: () => ({ emit: () => undefined }) } as unknown as Server,
    {} as SessionStore,
    {} as PiAgentManager,
    triggers,
    {} as ConversationRouter,
    undefined,
    {
      revoke: async (delegationId) => {
        revoked.push(delegationId);
      },
    },
  );
  return { engine, revoked };
}

const DELEGATED = {
  participantId: "alice@x",
  delegationId: "d1",
  delegationToken: "delegation-token",
};

test("removing a trigger, or replacing its delegation, revokes the delegation it held", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-triggers-"));
  try {
    const triggers = new TriggerManager();
    const { revoked } = engineOver(triggers);
    const hook = triggers.create("s1", root, {
      name: "hook",
      kind: "callback",
      prompt: "p",
    });
    triggers.setDelegation("s1", hook.id, DELEGATED);
    triggers.setDelegation("s1", hook.id, { ...DELEGATED, delegationId: "d2" });
    assert.deepEqual(revoked, ["d1"]);

    triggers.remove("s1", hook.id);
    assert.deepEqual(revoked, ["d1", "d2"]);

    const plain = triggers.create("s1", root, {
      name: "plain",
      kind: "callback",
      prompt: "p",
    });
    triggers.remove("s1", plain.id);
    assert.deepEqual(revoked, ["d1", "d2"], "nothing to revoke without one");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * An engine over a real manager and run registry, with one delegated
 * "Nightly report" schedule, recording what it revokes and posts.
 */
function engineWithNightly(root: string) {
  const triggers = new TriggerManager(new InMemoryTriggerDelegationStore());
  const runs = new RunRegistry(new InMemoryRunStore());
  const revoked: string[] = [];
  const posted: PostInput[] = [];
  const engine = new TriggerEngine(
    { to: () => ({ emit: () => undefined }) } as unknown as Server,
    { listAgents: async () => [] } as unknown as SessionStore,
    {} as PiAgentManager,
    triggers,
    {
      post: async (input: PostInput) => {
        posted.push(input);
      },
    } as unknown as ConversationRouter,
    undefined,
    {
      revoke: async (delegationId) => {
        revoked.push(delegationId);
      },
    },
    runs,
  );
  const nightly = triggers.create("s1", root, {
    name: "nightly",
    kind: "schedule",
    title: "Nightly report",
    prompt: "p",
    schedule: { every: "1h" },
  });
  triggers.setDelegation("s1", nightly.id, DELEGATED);
  return { triggers, runs, engine, revoked, posted, nightly };
}

test("a lapsed delegation is dropped, revoked, and announced in the session's main chat", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-triggers-"));
  try {
    const { triggers, engine, revoked, posted, nightly } =
      engineWithNightly(root);

    await engine.dropLapsedDelegation("s1", nightly.id);
    assert.deepEqual(revoked, ["d1"]);
    assert.equal(
      triggers.getStored("s1", nightly.id)?.participantId,
      "alice@x",
    );
    assert.equal(triggers.getStored("s1", nightly.id)?.delegationId, undefined);
    assert.equal(triggers.delegationOf("s1", nightly.id), undefined);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].author.id, SYSTEM_AUTHOR.id);
    assert.equal(posted[0].conversationId, PRIME_AGENT_ID);
    assert.equal(posted[0].provokes, false);
    assert.match(posted[0].content, /"Nightly report"/);
    assert.match(posted[0].content, /alice@x/);
    assert.match(posted[0].content, /expired or been revoked/);

    await engine.dropLapsedDelegation("s1", nightly.id);
    assert.equal(posted.length, 1, "nothing to drop twice");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a lapse mid-turn strips the delegation from the open Run, which falls back to the creator's assertion or is refused", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-triggers-"));
  try {
    const { triggers, runs, engine, nightly } = engineWithNightly(root);
    runs.open({
      sessionId: "s1",
      participantId: "sub-1",
      ingress: "schedule",
      audienceParticipantId: "alice@x",
      delegation: triggers.delegationOf("s1", nightly.id),
    });
    const assertions = new IdentityAssertionCache();
    const egress = () =>
      chooseEgressIdentity(
        { runs, assertions, identityHeader: "x-tangent-on-behalf-of" },
        { sessionId: "s1", agentId: "sub-1" },
        undefined,
      );
    assert.equal(egress().source?.kind, "delegation");
    assert.equal(egress().token, "delegation-token");

    await engine.dropLapsedDelegation("s1", nightly.id);
    assert.equal(runs.delegationFor("s1", "sub-1"), undefined);
    assert.deepEqual(runs.participantsFor("s1", "sub-1"), ["alice@x"]);
    assert.throws(egress, ParticipantAssertionExpiredError);

    assertions.record("alice@x", ALICE, "bearer");
    assert.deepEqual(egress(), {
      applied: { kind: "participant", id: "alice@x" },
      token: ALICE,
      source: { kind: "assertion" },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("disposing a session revokes its triggers' delegations, read from disk when cold", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-triggers-"));
  try {
    const earlier = new TriggerManager();
    const hook = earlier.create("s1", root, {
      name: "hook",
      kind: "callback",
      prompt: "p",
    });
    earlier.setDelegation("s1", hook.id, DELEGATED);

    const cold = new TriggerManager();
    const { engine, revoked } = engineOver(cold);
    engine.dispose("s1", root);
    assert.deepEqual(revoked, ["d1"]);
    assert.deepEqual(cold.listStored("s1"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
