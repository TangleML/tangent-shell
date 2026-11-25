import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
} from "@tangent/shared/contracts.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** Native key env vars the proxy-provider extension uses in direct mode. */
const PROVIDER_KEY_ENV_VAR_NAMES: Record<string, readonly string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  groq: ["GROQ_API_KEY"],
  xai: ["XAI_API_KEY"],
};

export function hasProviderApiKey(provider: string, env: Env): boolean {
  return (PROVIDER_KEY_ENV_VAR_NAMES[provider] ?? []).some((name) =>
    Boolean(env[name]),
  );
}

export function hasAnyProviderApiKey(env: Env): boolean {
  return Object.keys(PROVIDER_KEY_ENV_VAR_NAMES).some((provider) =>
    hasProviderApiKey(provider, env),
  );
}

function usesGateway(env: Env): boolean {
  return Boolean(env.PI_PROXY_URL && env.PI_PROXY_API_KEY);
}

/**
 * The `provider/model` an agent runs when nothing is selected. In direct mode
 * only keyed providers are registered, so when the shared default's provider has
 * no key, the first curated model of a keyed provider is used instead.
 */
export function defaultModelId(env: Env): string {
  if (usesGateway(env)) return DEFAULT_MODEL_ID;
  const [defaultProvider] = DEFAULT_MODEL_ID.split("/");
  if (hasProviderApiKey(defaultProvider, env)) return DEFAULT_MODEL_ID;
  return (
    AVAILABLE_MODELS.find((model) => hasProviderApiKey(model.provider, env))
      ?.id ?? DEFAULT_MODEL_ID
  );
}
