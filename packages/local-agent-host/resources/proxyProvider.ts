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
