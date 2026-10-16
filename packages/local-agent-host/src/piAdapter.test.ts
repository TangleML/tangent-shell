import assert from "node:assert/strict";
import { test } from "node:test";

import type { RemoteSpawnCommand } from "@tangent/shared/remoteSubagent.ts";

import { buildPiArgs, piEnv, type PiLaunchOptions } from "./piAdapter.ts";

const command: RemoteSpawnCommand = {
  sessionId: "session-1",
  agentId: "agent-1",
  name: "worker",
  tools: [],
  systemPrompt: "",
  autoRelayToPrime: true,
};

const baseLaunch: PiLaunchOptions = {
  bin: "pi",
  cwd: "/workspace",
  proxyExtensionPath: "/ext/proxy.ts",
  sessionResourceExtensionPath: "/ext/sessionResources.ts",
};

test("buildPiArgs loads the session-resources extension when the host API is set", () => {
  const args = buildPiArgs(command, {
    ...baseLaunch,
    hostApiUrl: "http://127.0.0.1:1234",
  });

  const idx = args.indexOf("--extension");
  assert.notEqual(idx, -1);
  assert.ok(args.includes("/ext/sessionResources.ts"));
});

test("buildPiArgs omits the extension when no host API is set", () => {
  const args = buildPiArgs(command, baseLaunch);

  assert.equal(args.includes("/ext/sessionResources.ts"), false);
});

test("buildPiArgs grants pi's full default toolset (no --tools allowlist)", () => {
  const args = buildPiArgs(command, {
    ...baseLaunch,
    hostApiUrl: "http://127.0.0.1:1234",
  });

  assert.equal(args.includes("--tools"), false);
});

test("buildPiArgs does not disable skill discovery", () => {
  const args = buildPiArgs(command, baseLaunch);

  assert.equal(args.includes("--no-skills"), false);
});

test("piEnv injects the host API and session/agent ids when the API is set", () => {
  const env = piEnv(command, {
    ...baseLaunch,
    hostApiUrl: "http://127.0.0.1:1234",
    hostApiToken: "secret",
  });

  assert.equal(env.TANGENT_HOST_API_URL, "http://127.0.0.1:1234");
  assert.equal(env.TANGENT_HOST_API_TOKEN, "secret");
  assert.equal(env.TANGENT_SESSION_ID, "session-1");
  assert.equal(env.TANGENT_AGENT_ID, "agent-1");
});

test("piEnv omits the host API env when no API is set", () => {
  const env = piEnv(command, baseLaunch);

  assert.equal("TANGENT_HOST_API_URL" in env, false);
  assert.equal("TANGENT_SESSION_ID" in env, false);
});
