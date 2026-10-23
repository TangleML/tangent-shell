import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  MintRemoteEnvTokenParams,
  ScopedEnvToken,
} from "./remoteEnvToken.ts";
import { startScopedConnection } from "./scopedConnection.ts";

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

const base = {
  shellUrl: "http://shell.test",
  selector: "projectId:project-a",
  email: "dev@localhost",
};

test("mints, connects, and pins the minted environment id on refresh", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mintCalls: MintRemoteEnvTokenParams[] = [];
  const connects: Array<{ token: string; environmentId: string }> = [];
  let count = 0;
  const mint = async (
    params: MintRemoteEnvTokenParams,
  ): Promise<ScopedEnvToken> => {
    mintCalls.push(params);
    count += 1;
    return {
      token: `token-${count}`,
      environmentId: "env-minted",
      expiresAtMs: Date.now() + 100_000,
    };
  };

  const stop = startScopedConnection({
    ...base,
    initialEnvironmentId: "env-pin",
    connect: (token, environmentId) => connects.push({ token, environmentId }),
    onError: () => {},
    mint,
  });
  await flush();

  assert.equal(connects.length, 1);
  assert.deepEqual(connects[0], {
    token: "token-1",
    environmentId: "env-minted",
  });
  assert.equal(mintCalls[0].environmentId, "env-pin");

  t.mock.timers.tick(80_000);
  await flush();

  assert.equal(connects.length, 2);
  assert.equal(mintCalls[1].environmentId, "env-minted");
  stop();
});

test("reports the error and retries after a failed mint", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const errors: string[] = [];
  let calls = 0;
  const mint = async (): Promise<ScopedEnvToken> => {
    calls += 1;
    if (calls === 1) throw new Error("mint failed");
    return { token: "token", environmentId: "env" };
  };
  const connects: number[] = [];

  const stop = startScopedConnection({
    ...base,
    connect: () => connects.push(1),
    onError: (message) => errors.push(message),
    mint,
  });
  await flush();

  assert.deepEqual(errors, ["mint failed"]);
  assert.equal(connects.length, 0);

  t.mock.timers.tick(5_000);
  await flush();

  assert.equal(connects.length, 1);
  stop();
});

test("stop cancels the pending refresh", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const mint = async (): Promise<ScopedEnvToken> => {
    calls += 1;
    return {
      token: "token",
      environmentId: "env",
      expiresAtMs: Date.now() + 100_000,
    };
  };

  const stop = startScopedConnection({
    ...base,
    connect: () => {},
    onError: () => {},
    mint,
  });
  await flush();
  assert.equal(calls, 1);

  stop();
  t.mock.timers.tick(200_000);
  await flush();

  assert.equal(calls, 1);
});
