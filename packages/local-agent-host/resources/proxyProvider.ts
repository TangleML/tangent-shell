// @ts-nocheck
/**
 * Loaded into local pi sub-agents via `--extension` when a pi proxy URL is set.
 * Hosts copy it next to their bundle. Authored against pi's extension runtime
 * (loaded with jiti), so it is excluded from this package's type-check and
 * lint. Mirrors the server's `apps/server/src/pi/extensions/proxyProvider.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROXY_URL = (process.env.PI_PROXY_URL ?? "").replace(/\/+$/, "");

const ANTHROPIC_CATALOG_COMPAT = {
  forceAdaptiveThinking: true,
  supportsStrictTools: true,
};

export default function (pi: ExtensionAPI) {
  // The host validates this deployment catalog before passing it to Pi.
  if (process.env.TANGENT_MODEL_CATALOG_JSON) {
    const catalog = JSON.parse(process.env.TANGENT_MODEL_CATALOG_JSON);
    const groups = new Map();
    for (const model of catalog.models) {
      const provider = model.tangentModelId.split("/")[0];
      const group = groups.get(provider) ?? { api: model.api, models: [] };
      if (group.api !== model.api)
        throw new Error("Catalog provider mixes protocols");
      group.models.push({
        id: model.id,
        name: model.label,
        reasoning: model.reasoningEfforts.length > 0,
        input: model.input,
        contextWindow: model.contextWindow,
        maxTokens: model.maxOutputTokens,
        thinkingLevelMap: model.thinkingLevelMap,
        compat:
          model.api === "anthropic-messages"
            ? ANTHROPIC_CATALOG_COMPAT
            : undefined,
        // Costs are unspecified by this deployment contract, not known to be free.
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      });
      groups.set(provider, group);
    }
    for (const [provider, group] of groups) {
      pi.registerProvider(provider, {
        baseUrl:
          group.api === "anthropic-messages"
            ? `${PROXY_URL}/apis/anthropic`
            : `${PROXY_URL}/v1`,
        apiKey: "$PI_PROXY_API_KEY",
        ...group,
      });
    }
    return;
  }
  pi.registerProvider("anthropic", {
    baseUrl: `${PROXY_URL}/apis/anthropic`,
    apiKey: "$PI_PROXY_API_KEY",
  });

  pi.registerProvider("openai", {
    baseUrl: `${PROXY_URL}/v1`,
    apiKey: "$PI_PROXY_API_KEY",
  });

  pi.registerProvider("google", {
    baseUrl: `${PROXY_URL}/apis/google/v1`,
    apiKey: "$PI_PROXY_API_KEY",
  });

  pi.registerProvider("groq", {
    baseUrl: `${PROXY_URL}/vendors/groq/openai/v1`,
    apiKey: "$PI_PROXY_API_KEY",
  });

  pi.registerProvider("xai", {
    baseUrl: `${PROXY_URL}/vendors/xai/v1`,
    apiKey: "$PI_PROXY_API_KEY",
  });
}
