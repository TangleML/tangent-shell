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
