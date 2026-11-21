import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

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

test("a trigger's participant and delegation persist, and stay off the wire", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tangent-triggers-"));
  try {
    const triggers = new TriggerManager();
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

    const reloaded = new TriggerManager();
    reloaded.register("s1", root);
    const stored = reloaded.getStored("s1", created.id);
    assert.equal(stored?.participantId, "alice@x");
    assert.equal(stored?.delegationId, "d1");
    assert.equal(stored?.delegationToken, "delegation-token");
    const wire = JSON.stringify(reloaded.get("s1", created.id));
    assert.equal(wire.includes("delegation-token"), false);
    assert.equal(wire.includes("alice@x"), false);

    reloaded.setDelegation("s1", created.id, { participantId: "bob@x" });
    assert.equal(reloaded.getStored("s1", created.id)?.delegationId, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
