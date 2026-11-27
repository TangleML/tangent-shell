import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_MODEL_ID } from "@tangent/shared/contracts.ts";

import { defaultModelId, hasAnyProviderApiKey } from "./defaultModel.ts";

test("an OpenAI-only checkout defaults to an OpenAI model", () => {
  assert.equal(
    defaultModelId({ OPENAI_API_KEY: "sk-test" }),
    "openai/gpt-6.1-sol",
  );
});

test("a Google-only checkout defaults to a Google model", () => {
  assert.equal(
    defaultModelId({ GOOGLE_API_KEY: "g-test" }),
    "google/gemini-4-argon",
  );
});

test("the shared default is kept when its provider has a key", () => {
  assert.equal(
    defaultModelId({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" }),
    DEFAULT_MODEL_ID,
  );
});

test("a gateway serves every provider, so the shared default is kept", () => {
  assert.equal(
    defaultModelId({
      PI_PROXY_URL: "https://proxy.test",
      PI_PROXY_API_KEY: "k",
      OPENAI_API_KEY: "o",
    }),
    DEFAULT_MODEL_ID,
  );
});

test("a half-configured gateway falls back to direct keys", () => {
  assert.equal(
    defaultModelId({
      PI_PROXY_URL: "https://proxy.test",
      OPENAI_API_KEY: "o",
    }),
    "openai/gpt-6.1-sol",
  );
});

test("no credentials keeps the shared default", () => {
  assert.equal(defaultModelId({}), DEFAULT_MODEL_ID);
});

test("a key with no curated model keeps the shared default", () => {
  assert.equal(defaultModelId({ GROQ_API_KEY: "g" }), DEFAULT_MODEL_ID);
  assert.ok(hasAnyProviderApiKey({ GROQ_API_KEY: "g" }));
});

test("empty key values do not count", () => {
  assert.equal(hasAnyProviderApiKey({ OPENAI_API_KEY: "" }), false);
});
