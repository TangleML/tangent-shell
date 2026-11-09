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
 *
 * Two modes, selected by whether an LLM gateway is configured:
 *
 * - Gateway — when both `PI_PROXY_URL` and `PI_PROXY_API_KEY` are set, every
 *   provider is routed through that single proxy via its per-vendor sub-paths
 *   (the Shopify llm-gateway layout). This is the deployed default.
 * - Direct — when either is missing, each provider is registered straight
 *   against its own public API using the well-known key/base-URL env vars
 *   (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …). This lets a plain checkout talk
 *   to OpenAI/Anthropic without a gateway (see `start_local.sh`).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const stripSlash = (url: string): string => url.replace(/\/+$/, "");

const PROXY_URL = stripSlash(process.env.PI_PROXY_URL ?? "");
const PROXY_API_KEY = process.env.PI_PROXY_API_KEY ?? "";

// A gateway needs both an endpoint and its credential; without either we fall
// back to talking to each provider's public API directly.
const useGateway = PROXY_URL !== "" && PROXY_API_KEY !== "";

/**
 * Registers the gateway routes — one proxy origin with a per-vendor sub-path per
 * provider — so selecting any built-in model "just works" through the proxy.
 */
function registerGatewayProviders(pi: ExtensionAPI): void {
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

/**
 * Registers only the providers whose native API key is present, each against its
 * own public endpoint. Base URLs follow the suffix convention Pi expects and the
 * gateway routes mirror: the OpenAI-compatible base includes `/v1`; the
 * Anthropic base does not (Pi appends `/v1/messages`). The `$VAR` apiKey is
 * resolved from the environment by Pi at request time.
 */
function registerDirectProviders(pi: ExtensionAPI): void {
  if (process.env.OPENAI_API_KEY) {
    pi.registerProvider("openai", {
      baseUrl: stripSlash(
        process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      ),
      apiKey: "$OPENAI_API_KEY",
    });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    pi.registerProvider("anthropic", {
      baseUrl: stripSlash(
        process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      ),
      apiKey: "$ANTHROPIC_API_KEY",
    });
  }

  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    pi.registerProvider("google", {
      baseUrl: stripSlash(
        process.env.GOOGLE_BASE_URL ??
          "https://generativelanguage.googleapis.com/v1beta/openai",
      ),
      apiKey: process.env.GEMINI_API_KEY
        ? "$GEMINI_API_KEY"
        : "$GOOGLE_API_KEY",
    });
  }

  if (process.env.GROQ_API_KEY) {
    pi.registerProvider("groq", {
      baseUrl: stripSlash(
        process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
      ),
      apiKey: "$GROQ_API_KEY",
    });
  }

  if (process.env.XAI_API_KEY) {
    pi.registerProvider("xai", {
      baseUrl: stripSlash(process.env.XAI_BASE_URL ?? "https://api.x.ai/v1"),
      apiKey: "$XAI_API_KEY",
    });
  }
}

export default function (pi: ExtensionAPI) {
  if (useGateway) {
    registerGatewayProviders(pi);
  } else {
    registerDirectProviders(pi);
  }
}
