import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { InMemoryTriggerDelegationStore } from "../../store/inMemoryTriggerDelegationStore.ts";
import { TriggerManager } from "./triggerManager.ts";

test("reconcileBundle refreshes, adds and drops bundle triggers, sparing runtime ones", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-triggers-"));
  try {
    const triggers = new TriggerManager();
    triggers.seedFromBundle("s1", root, [
      { name: "hook", kind: "callback", prompt: "v1 {{body}}" },
      {
        name: "nightly",
        kind: "schedule",
        prompt: "v1",
        schedule: { every: "1h" },
      },
    ]);
    triggers.create("s1", root, {
      name: "mine",
      kind: "schedule",
      prompt: "p",
      schedule: { every: "5m" },
    });
    const hook = triggers.listStored("s1").find((t) => t.name === "hook")!;
    triggers.update("s1", hook.id, { enabled: false });

    triggers.reconcileBundle("s1", root, [
      { name: "hook", kind: "callback", prompt: "v2 {{body}}" },
      {
        name: "weekly",
        kind: "schedule",
        prompt: "new",
        schedule: { every: "7d" },
      },
    ]);

    const byName = new Map(triggers.listStored("s1").map((t) => [t.name, t]));
    assert.deepEqual([...byName.keys()].sort(), ["hook", "mine", "weekly"]);
    const refreshed = byName.get("hook")!;
    assert.equal(refreshed.id, hook.id);
    assert.equal(refreshed.secret, hook.secret, "callback URLs stay valid");
    assert.equal(refreshed.enabled, false, "the user's toggle survives");
    assert.equal(refreshed.prompt, "v2 {{body}}");
    assert.equal(byName.get("mine")?.source, "runtime");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a trigger's participant and delegation persist, with the token in the store and off the wire", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-triggers-"));
  try {
    const tokens = new InMemoryTriggerDelegationStore();
    const triggers = new TriggerManager(tokens);
    const created = triggers.create("s1", root, {
      name: "nightly",
      kind: "schedule",
      prompt: "p",
      schedule: { every: "1h" },
    });
    triggers.setDelegation("s1", created.id, {
      participantId: "alice@x",
      delegationId: "d1",
      delegationToken: "delegation-token",
    });
    const file = readFileSync(
      path.join(root, ".tangent", "triggers.json"),
      "utf8",
    );
    assert.equal(file.includes("delegation-token"), false);
    assert.equal(file.includes("d1"), true);

    const reloaded = new TriggerManager(tokens);
    reloaded.register("s1", root);
    const stored = reloaded.getStored("s1", created.id);
    assert.equal(stored?.participantId, "alice@x");
    assert.equal(stored?.delegationId, "d1");
    assert.deepEqual(reloaded.delegationOf("s1", created.id), {
      triggerId: created.id,
      participantId: "alice@x",
      token: "delegation-token",
    });
    const wire = JSON.stringify(reloaded.get("s1", created.id));
    assert.equal(wire.includes("delegation-token"), false);
    assert.equal(wire.includes("alice@x"), false);

    reloaded.setDelegation("s1", created.id, { participantId: "bob@x" });
    assert.equal(reloaded.getStored("s1", created.id)?.delegationId, undefined);
    assert.equal(tokens.get("s1", created.id), undefined);
    assert.equal(reloaded.delegationOf("s1", created.id), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("removing a trigger forgets its token; a store without one yields no delegation", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-triggers-"));
  try {
    const tokens = new InMemoryTriggerDelegationStore();
    const triggers = new TriggerManager(tokens);
    const hook = triggers.create("s1", root, {
      name: "hook",
      kind: "callback",
      prompt: "p",
    });
    triggers.setDelegation("s1", hook.id, {
      participantId: "alice@x",
      delegationId: "d1",
      delegationToken: "delegation-token",
    });
    tokens.delete("s1", hook.id);
    assert.equal(triggers.delegationOf("s1", hook.id), undefined);

    tokens.put({
      sessionId: "s1",
      triggerId: hook.id,
      participantId: "alice@x",
      delegationId: "stale",
      token: "old-token",
    });
    assert.equal(
      triggers.delegationOf("s1", hook.id),
      undefined,
      "a token for another delegation is not this trigger's",
    );

    tokens.put({
      sessionId: "s1",
      triggerId: hook.id,
      participantId: "alice@x",
      delegationId: "d1",
      token: "delegation-token",
    });
    triggers.remove("s1", hook.id);
    assert.equal(tokens.get("s1", hook.id), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Writes a pre-split triggers file whose one trigger still carries its token. */
function writeLegacyTriggersFile(root: string): string {
  const dir = path.join(root, ".tangent");
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const file = path.join(dir, "triggers.json");
  writeFileSync(
    file,
    JSON.stringify({
      triggers: [
        {
          id: "t1",
          name: "nightly",
          kind: "schedule",
          prompt: "p",
          schedule: { every: "1h" },
          enabled: true,
          source: "runtime",
          target: { type: "prime" },
          participantId: "alice@x",
          delegationId: "d1",
          delegationToken: "legacy-token",
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  );
  return file;
}

test("a legacy triggers file's token is lifted into the store once and dropped from disk", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-triggers-"));
  try {
    const file = writeLegacyTriggersFile(root);

    const tokens = new InMemoryTriggerDelegationStore();
    const triggers = new TriggerManager(tokens);
    triggers.register("s1", root);
    assert.deepEqual(triggers.delegationOf("s1", "t1"), {
      triggerId: "t1",
      participantId: "alice@x",
      token: "legacy-token",
    });
    assert.equal(
      "delegationToken" in (triggers.getStored("s1", "t1") ?? {}),
      false,
    );
    const rewritten = readFileSync(file, "utf8");
    assert.equal(rewritten.includes("legacy-token"), false);
    assert.equal(rewritten.includes('"delegationId": "d1"'), true);

    tokens.delete("s1", "t1");
    const again = new TriggerManager(tokens);
    again.register("s1", root);
    assert.equal(again.delegationOf("s1", "t1"), undefined, "imported once");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a legacy token the store refuses is dropped, and the trigger still loads", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-triggers-"));
  try {
    const file = writeLegacyTriggersFile(root);
    const refusing = new TriggerManager({
      put: () => {
        throw new Error("FOREIGN KEY constraint failed");
      },
      get: () => undefined,
      delete: () => undefined,
    });

    refusing.register("s1", root);
    assert.equal(refusing.getStored("s1", "t1")?.delegationId, "d1");
    assert.equal(refusing.delegationOf("s1", "t1"), undefined);
    assert.equal(readFileSync(file, "utf8").includes("legacy-token"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hooks hear every trigger let go, and the record a replaced delegation superseded", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-triggers-"));
  try {
    const removed: string[] = [];
    const replaced: (string | undefined)[] = [];
    const triggers = new TriggerManager();
    triggers.listen({
      onRemoved: (sessionId, stored) => {
        removed.push(`${sessionId}:${stored.name}`);
      },
      onDelegationReplaced: (_sessionId, stored) => {
        replaced.push(stored.delegationId);
      },
    });

    const mine = triggers.create("s1", root, {
      name: "mine",
      kind: "callback",
      prompt: "p",
    });
    const d1 = { participantId: "alice@x", delegationId: "d1" };
    triggers.setDelegation("s1", mine.id, d1);
    triggers.setDelegation("s1", mine.id, d1);
    triggers.setDelegation("s1", mine.id, { ...d1, delegationId: "d2" });
    triggers.setDelegation("s1", mine.id, { participantId: "bob@x" });
    assert.deepEqual(replaced, ["d1", "d2"]);

    triggers.seedFromBundle("s1", root, [
      { name: "hook", kind: "callback", prompt: "p" },
    ]);
    triggers.reconcileBundle("s1", root, []);
    triggers.remove("s1", mine.id);
    triggers.create("s1", root, {
      name: "other",
      kind: "callback",
      prompt: "p",
    });
    triggers.dispose("s1");
    assert.deepEqual(removed, ["s1:hook", "s1:mine", "s1:other"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
