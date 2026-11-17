// @ts-nocheck
/**
 * Loaded into local pi sub-agents via `--extension` when a pi proxy URL is set.
 * Hosts copy it next to their bundle. Authored against pi's extension runtime
 * (loaded with jiti), so it is excluded from this package's type-check and
 * lint. Mirrors the server's `apps/server/src/pi/extensions/proxyProvider.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROXY_URL = (process.env.PI_PROXY_URL ?? "").replace(/\/+$/, "");

export default function (pi: ExtensionAPI) {
  pi.registerProvider("anthropic", {
    baseUrl: `${PROXY_URL}/apis/anthropic`,
    apiKey: "$PI_PROXY_API_KEY",
  });

  pi.registerProvider("openai", {
    baseUrl: `${PROXY_URL}/v1`,
    apiKey: "$PI_PROXY_API_KEY",
  });

  // A separate provider keeps the built-in OpenAI catalog intact. The unqualified
  // proxy model supports Responses; this does not pin Shopify-hosted inference.
  pi.registerProvider("deepseek", {
    baseUrl: `${PROXY_URL}/v1`,
    apiKey: "$PI_PROXY_API_KEY",
    api: "openai-responses",
    models: [
      {
        id: "deepseek-v4.1-flash",
        name: "DeepSeek V4.1 Flash",
        reasoning: true,
        thinkingLevelMap: {
          off: null,
          minimal: null,
          low: "low",
          medium: null,
          high: "high",
          xhigh: "max",
          max: "max",
        },
        input: ["text", "image"],
        // Fireworks route pricing from the proxy catalog (USD / million tokens).
        cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 384000,
      },
    ],
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
