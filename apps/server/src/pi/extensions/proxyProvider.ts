// @ts-nocheck
/**
 * Proxy provider extension loaded into every session Pi process via
 * `--extension`.
 *
 * This file is authored against Pi's extension runtime (it imports modules Pi
 * resolves when loading extensions), not against this repo's `node_modules`. It
 * is therefore excluded from our type-check (`@ts-nocheck`) and is never
 * imported by the server itself — only passed as a path to the Pi subprocess,
 * which loads it with jiti.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Trailing slash is stripped so per-provider paths concatenate cleanly.
const PROXY_URL = (process.env.PI_PROXY_URL ?? "").replace(/\/+$/, "");

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
  // Managed routes mirror the local shopify-proxy extension so selecting a
  // built-in model "just works" through the proxy.
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
