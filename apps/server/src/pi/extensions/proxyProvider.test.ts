import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

interface RegisteredProvider {
  baseUrl: string;
  apiKey: string;
}

/** A fake Pi `ExtensionAPI` that records `registerProvider` calls. */
function fakeApi(): {
  pi: unknown;
  providers: Map<string, RegisteredProvider>;
} {
  const providers = new Map<string, RegisteredProvider>();
  const pi = {
    registerProvider(name: string, config: RegisteredProvider) {
      providers.set(name, config);
    },
  };
  return { pi, providers };
}

const ENV_KEYS = [
  "PI_PROXY_URL",
  "PI_PROXY_API_KEY",
  "TANGENT_MODEL_CATALOG_JSON",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_BASE_URL",
] as const;

const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

/** Clears every env var the extension reads so each case starts from direct mode. */
function enterDirectMode(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

async function loadExtension(): Promise<(pi: unknown) => void> {
  const mod = await import("./proxyProvider.ts");
  return mod.default as (pi: unknown) => void;
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("direct mode registers Google against the native v1beta base (GEMINI_API_KEY)", async () => {
  enterDirectMode();
  process.env.GEMINI_API_KEY = "gemini-key";

  const register = await loadExtension();
  const { pi, providers } = fakeApi();
  register(pi);

  const google = providers.get("google");
  assert.ok(google, "Google provider is registered");
  assert.equal(
    google.baseUrl,
    "https://generativelanguage.googleapis.com/v1beta",
  );
  assert.equal(google.apiKey, "$GEMINI_API_KEY");
});

test("direct mode falls back to GOOGLE_API_KEY with the native v1beta base", async () => {
  enterDirectMode();
  process.env.GOOGLE_API_KEY = "google-key";

  const register = await loadExtension();
  const { pi, providers } = fakeApi();
  register(pi);

  const google = providers.get("google");
  assert.ok(google, "Google provider is registered");
  assert.equal(
    google.baseUrl,
    "https://generativelanguage.googleapis.com/v1beta",
  );
  assert.equal(google.apiKey, "$GOOGLE_API_KEY");
});

test("Anthropic catalog models use adaptive thinking and strict tools; others keep Pi's defaults", async () => {
  enterDirectMode();
  const catalogModel = (id: string, tangentModelId: string, api: string) => ({
    id,
    label: id,
    tangentModelId,
    api,
    reasoningEfforts: ["low", "high"],
    input: ["text"],
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    thinkingLevelMap: { off: null, low: "low", high: "high" },
  });
  process.env.TANGENT_MODEL_CATALOG_JSON = JSON.stringify({
    models: [
      catalogModel(
        "claude-fable-5-2",
        "proxy-anthropic/claude-fable-5-2",
        "anthropic-messages",
      ),
      catalogModel(
        "gpt-6.1-sol",
        "proxy-responses/gpt-6.1-sol",
        "openai-responses",
      ),
    ],
  });

  const register = await loadExtension();
  const registered = new Map<
    string,
    { models: { id: string; compat?: Record<string, unknown> }[] }
  >();
  register({
    registerProvider: (name: string, config: never) =>
      registered.set(name, config),
  });

  const [claude] = registered.get("proxy-anthropic")?.models ?? [];
  assert.deepEqual(claude?.compat, {
    forceAdaptiveThinking: true,
    supportsStrictTools: true,
  });
  const [gpt] = registered.get("proxy-responses")?.models ?? [];
  assert.equal(gpt?.compat, undefined);
});
