import assert from "node:assert/strict";
import { test } from "node:test";

import { parseModelsResponse, withConfiguredProviders } from "./piModels.ts";

test("maps Pi's available models to provider-qualified picker options", () => {
  const line = JSON.stringify({
    id: "list-models",
    type: "response",
    command: "get_available_models",
    success: true,
    data: {
      models: [
        {
          id: "claude-opus-5-5",
          name: "Claude Opus 5.5",
          provider: "anthropic",
          contextWindow: 1000000,
        },
        { id: "gpt-6-luna", provider: "openai" },
      ],
    },
  });
  assert.deepEqual(parseModelsResponse(line), [
    {
      id: "anthropic/claude-opus-5-5",
      label: "Claude Opus 5.5",
      provider: "anthropic",
    },
    { id: "openai/gpt-6-luna", label: "gpt-6-luna", provider: "openai" },
  ]);
});

test("ignores unrelated and non-JSON stdout lines", () => {
  assert.equal(parseModelsResponse("starting up"), undefined);
  assert.equal(
    parseModelsResponse(
      JSON.stringify({ type: "extension_ui_request", method: "notify" }),
    ),
    undefined,
  );
  assert.equal(
    parseModelsResponse(
      JSON.stringify({ type: "response", id: "other", success: true }),
    ),
    undefined,
  );
});

test("throws when Pi reports a failed response", () => {
  assert.throws(
    () =>
      parseModelsResponse(
        JSON.stringify({
          type: "response",
          id: "list-models",
          success: false,
          error: "boom",
        }),
      ),
    /boom/,
  );
});

const models = [
  { id: "anthropic/claude-opus-5-5", label: "Opus", provider: "anthropic" },
  { id: "openai/gpt-6-luna", label: "Luna", provider: "openai" },
  { id: "google/gemini-4-argon", label: "Argon", provider: "google" },
  {
    id: "anthropic-flex/claude-opus-5-5",
    label: "Flex",
    provider: "anthropic-flex",
  },
];

test("keeps every model when routed through the gateway", () => {
  const env = { PI_PROXY_URL: "https://proxy.test", PI_PROXY_API_KEY: "k" };
  assert.deepEqual(withConfiguredProviders(models, env), models);
});

test("without a gateway, keeps only providers whose API key is set", () => {
  const env = {
    PI_PROXY_URL: "https://proxy.test",
    ANTHROPIC_API_KEY: "a",
    GOOGLE_API_KEY: "g",
  };
  assert.deepEqual(
    withConfiguredProviders(models, env).map((m) => m.provider),
    ["anthropic", "google"],
  );
});

test("without a gateway or provider keys, keeps nothing", () => {
  assert.deepEqual(withConfiguredProviders(models, {}), []);
});
