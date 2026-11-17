import assert from "node:assert/strict";
import test from "node:test";

import { AVAILABLE_MODELS, DEFAULT_MODEL_ID } from "@tangent/shared/contracts.ts";

import localProxyProvider from "../../../../packages/local-agent-host/resources/proxyProvider";
import serverProxyProvider from "./extensions/proxyProvider";

function registrations(factory: typeof serverProxyProvider) {
  const providers = new Map<string, Record<string, unknown>>();
  factory({
    registerProvider(name: string, config: Record<string, unknown>) {
      providers.set(name, config);
    },
  });
  return providers;
}

test("server and local hosts register the same DeepSeek proxy model", () => {
  const server = registrations(serverProxyProvider);
  const local = registrations(localProxyProvider);
  assert.deepEqual(local, server);

  const deepseek = server.get("deepseek")!;
  assert.ok(String(deepseek.baseUrl).endsWith("/v1"));
  assert.equal(deepseek.apiKey, "$PI_PROXY_API_KEY");
  assert.equal(deepseek.api, "openai-responses");
  const models = deepseek.models as Record<string, unknown>[];
  assert.equal(models.length, 1);
  assert.equal(models[0].id, "deepseek-v4.1-flash");
  assert.deepEqual(models[0].input, ["text", "image"]);
  assert.equal(models[0].contextWindow, 1000000);
  assert.equal(models[0].maxTokens, 384000);
  assert.deepEqual(models[0].thinkingLevelMap, {
    off: null,
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
    xhigh: "max",
    max: "max",
  });
  assert.equal(server.get("openai")!.models, undefined);
  assert.ok(
    AVAILABLE_MODELS.some(
      (model) => model.id === "deepseek/deepseek-v4.1-flash",
    ),
  );
  assert.equal(DEFAULT_MODEL_ID, "openai/gpt-6.1-sol");
});
