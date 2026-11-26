import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { piEnv } from "@tangent/local-agent-host/piAdapter.ts";
import localProvider from "@tangent/local-agent-host/resources/proxyProvider.ts";
import {
  findCatalogModel,
  nearestThinkingLevel,
  parseModelCatalog,
  resolveCatalogSelection,
  supportedThinkingLevels,
} from "@tangent/shared/modelCatalog.ts";

import {
  catalogRequestHeaders,
  loadConfiguredCatalog,
} from "./modelCatalog.ts";
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
  assert.equal(
    piEnv(command, { ...options, proxyUrl: undefined })
      .TANGENT_MODEL_CATALOG_JSON,
    undefined,
  );
});

test("stored selections resolve through provider prefixes and replacements", () => {
  const catalog = parseModelCatalog(fixture);
  for (const selected of [
    model.id,
    model.tangentModelId,
    `openai/${model.id}`,
    "old-example",
    "anthropic/old-example",
  ]) {
    assert.equal(findCatalogModel(catalog, selected)?.id, model.id, selected);
    assert.equal(
      resolveCatalogSelection(catalog, selected),
      model.tangentModelId,
    );
  }
  assert.equal(findCatalogModel(catalog, "openai/gone"), undefined);
  assert.equal(
    resolveCatalogSelection(catalog, "openai/gone"),
    model.tangentModelId,
  );
  assert.equal(
    resolveCatalogSelection(catalog, undefined),
    model.tangentModelId,
  );
});

test("thinking depth clamps to the nearest level the model supports", () => {
  const supported = supportedThinkingLevels(
    parseModelCatalog(fixture).models[0],
  );
  assert.deepEqual(supported, ["low", "high", "xhigh", "max"]);
  assert.equal(nearestThinkingLevel("high", supported), "high");
  assert.equal(nearestThinkingLevel("medium", supported), "low");
  assert.equal(nearestThinkingLevel("off", supported), "low");
  assert.equal(nearestThinkingLevel("minimal", []), "minimal");
});

test("a configured catalog requires the LLM gateway it routes models through", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "catalog-"));
  const file = path.join(dir, "models.json");
  await writeFile(file, JSON.stringify(fixture));

  await assert.rejects(
    loadConfiguredCatalog({ TANGENT_MODEL_CATALOG_FILE: file }),
    /set PI_PROXY_URL/,
  );
  await assert.rejects(
    loadConfiguredCatalog({
      TANGENT_MODEL_CATALOG_URL: "https://tangle.example.com/api/models",
    }),
    /set PI_PROXY_URL/,
  );
  const catalog = await loadConfiguredCatalog({
    TANGENT_MODEL_CATALOG_FILE: file,
    PI_PROXY_URL: "https://gateway.example.com",
  });
  assert.equal(catalog?.defaults.tangent, model.tangentModelId);
  assert.equal(await loadConfiguredCatalog({}), undefined);
});

test("a catalog on the Tangle API origin is fetched with the Tangle cookie", () => {
  const tangle = "https://tangle.example.com";
  const onTangle = new URL(`${tangle}/api/models`);
  const elsewhere = new URL("https://other.example.com/models");
  const cookie = "MINERVA_TOKEN=session";
  assert.deepEqual(
    catalogRequestHeaders(onTangle, { TANGLE_TOKEN: cookie }, tangle),
    { cookie },
  );
  assert.deepEqual(
    catalogRequestHeaders(elsewhere, { TANGLE_TOKEN: cookie }, tangle),
    {},
  );
  assert.deepEqual(
    catalogRequestHeaders(
      onTangle,
      { TANGLE_TOKEN: cookie, TANGENT_MODEL_CATALOG_TOKEN: "t" },
      tangle,
    ),
    { Authorization: "Bearer t" },
  );
});
