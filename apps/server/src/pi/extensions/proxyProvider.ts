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
