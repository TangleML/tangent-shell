import assert from "node:assert/strict";
import test from "node:test";

import { parseModelCatalog } from "@tangent/shared/modelCatalog.ts";

import localProvider from "../../../packages/local-agent-host/resources/proxyProvider.ts";
import { piEnv } from "../../../packages/local-agent-host/src/piAdapter.ts";
import serverProvider from "./pi/extensions/proxyProvider.ts";

const model = {
  id: "example-model",
  label: "Example model",
  tangentModelId: "example/example-model",
  api: "openai-responses",
  reasoningEfforts: ["low", "high", "max"],
  input: ["text"],
  contextWindow: 100000,
  maxOutputTokens: 10000,
  thinkingLevelMap: {
    off: null,
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
    xhigh: "max",
    max: "max",
  },
};
const fixture = {
  schemaVersion: 1,
  defaults: {
    browser: model.id,
    tangent: model.tangentModelId,
    orchestrator: model.id,
    subagent: model.id,
    embedding: "example-embedding",
  },
  replacements: { "old-example": model.id },
  models: [model],
};

test("catalog validates data and rejects unsafe or inconsistent definitions", () => {
  assert.equal(parseModelCatalog(fixture).models[0].id, model.id);
  for (const invalid of [
    { ...fixture, schemaVersion: 2 },
    { ...fixture, models: [model, model] },
    { ...fixture, models: [{ ...model, apiKey: "forbidden" }] },
    { ...fixture, models: [{ ...model, api: "unknown-api" }] },
    {
      ...fixture,
      models: [
        {
          ...model,
          thinkingLevelMap: { ...model.thinkingLevelMap, medium: "medium" },
        },
      ],
    },
    { ...fixture, defaults: { ...fixture.defaults, tangent: "missing/model" } },
  ])
    assert.throws(() => parseModelCatalog(invalid));
});

test("server and local Pi extensions register the same deployment models", () => {
  const previous = process.env.TANGENT_MODEL_CATALOG_JSON;
  process.env.TANGENT_MODEL_CATALOG_JSON = JSON.stringify(
    parseModelCatalog(fixture),
  );
  try {
    const capture = (factory: typeof serverProvider) => {
      const providers = new Map<string, Record<string, unknown>>();
      factory({
        registerProvider(name: string, config: Record<string, unknown>) {
          providers.set(name, config);
        },
      });
      return providers;
    };
    const server = capture(serverProvider);
    assert.deepEqual(capture(localProvider), server);
    assert.equal(server.get("example")?.api, "openai-responses");
    const models = server.get("example")?.models as Record<string, unknown>[];
    assert.equal(models[0].id, model.id);
    assert.deepEqual(models[0].thinkingLevelMap, model.thinkingLevelMap);
  } finally {
    if (previous === undefined) delete process.env.TANGENT_MODEL_CATALOG_JSON;
    else process.env.TANGENT_MODEL_CATALOG_JSON = previous;
  }
});

test("local hosts receive validated model data, not catalog-fetch credentials", () => {
  const command = {
    sessionId: "s",
    agentId: "a",
    name: "Example",
    tools: [],
    systemPrompt: "",
    autoRelayToPrime: false,
    modelCatalog: parseModelCatalog(fixture),
  };
  const options = {
    bin: "pi",
    proxyExtensionPath: "extension.ts",
    proxyUrl: "https://proxy.example.com",
  };
  const env = piEnv(command, options);
  assert.deepEqual(
    JSON.parse(env.TANGENT_MODEL_CATALOG_JSON!),
    parseModelCatalog(fixture),
  );
  assert.equal(env.TANGENT_MODEL_CATALOG_TOKEN, undefined);
  assert.throws(
    () => piEnv(command, { ...options, proxyUrl: undefined }),
    /configured local proxy/,
  );
});
