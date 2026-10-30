import assert from "node:assert/strict";
import { test } from "node:test";

import { RunRegistry } from "../runs/runRegistry.ts";
import { InMemoryRunStore } from "../store/inMemoryRunStore.ts";
import {
  type AgentCaller,
  type AgentTokenResolver,
  callerActingTeam,
} from "./agentCaller.ts";

const TOKENS: Record<string, AgentCaller> = {
  "prime-token": { sessionId: "s1", agentId: "prime" },
  "sub-token": { sessionId: "s1", agentId: "sub-1" },
};
const agents: AgentTokenResolver = (token) =>
  token ? TOKENS[token] : undefined;

/** A registry where Prime's open Run acts as `team-a` and the sub-agent's as none. */
function runsWithPrimeTeam(): RunRegistry {
  const runs = new RunRegistry(new InMemoryRunStore());
  runs.open({
    sessionId: "s1",
    participantId: "prime",
    ingress: "reaction",
    actingTeam: "team-a",
  });
  runs.open({ sessionId: "s1", participantId: "sub-1", ingress: "tool" });
  return runs;
}

test("the caller's team is its own open run's", () => {
  const runs = runsWithPrimeTeam();

  assert.equal(callerActingTeam("prime-token", agents, runs), "team-a");
  assert.equal(callerActingTeam("sub-token", agents, runs), undefined);
});

test("a missing or unknown agent token acts as no team", () => {
  const runs = runsWithPrimeTeam();

  assert.equal(callerActingTeam(undefined, agents, runs), undefined);
  assert.equal(callerActingTeam("forged", agents, runs), undefined);
});

test("an agent acting for another participant gets no team", () => {
  const runs = runsWithPrimeTeam();
  const asPrime = { sessionId: "s1", agentId: "prime" };

  assert.equal(
    callerActingTeam("prime-token", agents, runs, asPrime),
    "team-a",
  );
  assert.equal(callerActingTeam("sub-token", agents, runs, asPrime), undefined);
  assert.equal(
    callerActingTeam("prime-token", agents, runs, {
      sessionId: "s2",
      agentId: "prime",
    }),
    undefined,
  );
});
