import assert from "node:assert/strict";
import { test } from "node:test";

import type { EgressResponse } from "../../bundleUi/egressAllowlist.ts";
import {
  type DelegationEgress,
  TriggerDelegations,
} from "./triggerDelegation.ts";

interface Call {
  input: Parameters<DelegationEgress>[0];
  init: Parameters<DelegationEgress>[1];
  caller: string;
  options: Parameters<DelegationEgress>[3];
}

/** An egress stand-in that records calls and answers as told. */
function fakeEgress(answer: () => Promise<EgressResponse>) {
  const calls: Call[] = [];
  const egress: DelegationEgress = async (input, init, caller, options) => {
    calls.push({ input, init, caller, options });
    return answer();
  };
  return { calls, egress };
}

const PATH = "/api/tangent/delegations";
const HEADER = "x-tangent-on-behalf-of";

const ISSUED: EgressResponse = {
  ok: true,
  status: 201,
  headers: {},
  json: { id: "d1", token: "delegation-token" },
};

test("registering mints a delegation scoped to the trigger, as the participant", async () => {
  const { calls, egress } = fakeEgress(async () => ISSUED);
  const delegations = new TriggerDelegations(egress, PATH, HEADER);

  const granted = await delegations.register("t1", "alice@x", "assertion");
  assert.deepEqual(granted, {
    participantId: "alice@x",
    delegationId: "d1",
    delegationToken: "delegation-token",
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input, {
    target: "tangle",
    path: PATH,
  });
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(calls[0].init?.body, { scope: "trigger:t1" });
  assert.equal(calls[0].caller, "server");
  assert.deepEqual(calls[0].options, { identityToken: "assertion" });
});

test("a refused or failed registration yields no delegation", async () => {
  const refused = new TriggerDelegations(
    fakeEgress(async () => ({ ok: false, status: 401, headers: {} })).egress,
    PATH,
    HEADER,
  );
  assert.equal(await refused.register("t1", "alice@x", "assertion"), undefined);

  const malformed = new TriggerDelegations(
    fakeEgress(async () => ({ ok: true, status: 201, headers: {}, json: {} }))
      .egress,
    PATH,
    HEADER,
  );
  assert.equal(await malformed.register("t1", "alice@x", "a"), undefined);

  const failing = new TriggerDelegations(
    fakeEgress(async () => {
      throw new Error("upstream down");
    }).egress,
    PATH,
    HEADER,
  );
  assert.equal(await failing.register("t1", "alice@x", "a"), undefined);
});

test("revoking deletes by id, best effort; an unconfigured path does nothing", async () => {
  const { calls, egress } = fakeEgress(async () => ({
    ok: true,
    status: 204,
    headers: {},
  }));
  const delegations = new TriggerDelegations(egress, PATH, HEADER);
  await delegations.revoke("d1");
  assert.deepEqual(calls[0].input, {
    target: "tangle",
    path: "/api/tangent/delegations/d1",
  });
  assert.equal(calls[0].init?.method, "DELETE");
  assert.equal(calls[0].caller, "server");

  const failing = new TriggerDelegations(
    fakeEgress(async () => {
      throw new Error("upstream down");
    }).egress,
    PATH,
    HEADER,
  );
  await failing.revoke("d1");
});

test("delegations are off unless both the path and the identity header are set", async () => {
  const { calls, egress } = fakeEgress(async () => ISSUED);
  assert.equal(new TriggerDelegations(egress, PATH, HEADER).enabled, true);

  for (const off of [
    new TriggerDelegations(egress, "", HEADER),
    new TriggerDelegations(egress, PATH, ""),
    new TriggerDelegations(egress, "", ""),
  ]) {
    assert.equal(off.enabled, false);
    assert.equal(await off.register("t1", "alice@x", "a"), undefined);
    await off.revoke("d1");
  }
  assert.equal(calls.length, 0);
});
