import { readFile } from "node:fs/promises";

import {
  THINKING_LEVELS,
  type ThinkingLevel,
} from "@tangent/shared/contracts.ts";
import {
  findCatalogModel,
  type ModelCatalog,
  nearestThinkingLevel,
  parseModelCatalog,
  resolveCatalogSelection,
  supportedThinkingLevels,
} from "@tangent/shared/modelCatalog.ts";

import { TANGLE_API_URL } from "./config.ts";

function catalogUrl(value: string): URL {
  const parsed = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    parsed.hostname,
  );
  if (parsed.username || parsed.password)
    throw new Error("Catalog URL must not contain credentials");
  if (parsed.protocol === "https:") return parsed;
  if (parsed.protocol === "http:" && loopback) return parsed;
  throw new Error("Catalog URL requires HTTPS");
}

/**
 * A catalog on the Tangle API origin is authenticated the way the rest of the
 * server's Tangle egress is: `TANGLE_TOKEN` as a Cookie header. An explicit
 * catalog token is a bearer for any other host.
 */
interface CatalogCredentialEnv {
  TANGENT_MODEL_CATALOG_TOKEN?: string;
  TANGLE_TOKEN?: string;
}

export function catalogRequestHeaders(
  url: URL,
  env: CatalogCredentialEnv,
  tangleApiUrl = TANGLE_API_URL,
): Record<string, string> {
  if (env.TANGENT_MODEL_CATALOG_TOKEN)
    return { Authorization: `Bearer ${env.TANGENT_MODEL_CATALOG_TOKEN}` };
  if (env.TANGLE_TOKEN && url.origin === new URL(tangleApiUrl).origin)
    return { cookie: env.TANGLE_TOKEN };
  return {};
}

async function fetchCatalog(url: string): Promise<ModelCatalog> {
  const target = catalogUrl(url);
  const response = await fetch(target, {
    headers: catalogRequestHeaders(target, process.env),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Catalog fetch failed: ${response.status}`);
  return parseModelCatalog(await response.json());
}

/** Trusted deployment settings, never browser/session-supplied URLs or credentials. */
async function loadConfiguredCatalog(): Promise<ModelCatalog | undefined> {
  const file = process.env.TANGENT_MODEL_CATALOG_FILE;
  const url = process.env.TANGENT_MODEL_CATALOG_URL;
  if (file && url)
    throw new Error("Configure either a catalog file or URL, not both");
  if (file) return parseModelCatalog(JSON.parse(await readFile(file, "utf8")));
  if (url) return fetchCatalog(url);
  return undefined;
}

// Explicitly configured catalog failures fail startup, not fall back to a
// different provider. Standalone installations retain their existing defaults.
export const modelCatalog = await loadConfiguredCatalog();

export function resolveCatalogModel(selected?: string): string | undefined {
  if (!modelCatalog) return selected;
  const resolved = resolveCatalogSelection(modelCatalog, selected);
  if (selected && !findCatalogModel(modelCatalog, selected)) {
    console.warn(
      `[catalog] "${selected}" is not in the deployment catalog; using ${resolved}`,
    );
  }
  return resolved;
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

/**
 * Stored depths can predate the catalog, so the depth Pi is launched with is
 * clamped to what the resolved catalog model supports.
 */
export function resolveCatalogThinking<T extends string | undefined>(
  selected: string | undefined,
  thinking: T,
): T {
  if (!modelCatalog || thinking === undefined || !isThinkingLevel(thinking))
    return thinking;
  const model = findCatalogModel(
    modelCatalog,
    selected || modelCatalog.defaults.tangent,
  );
  if (!model) return thinking;
  return nearestThinkingLevel(thinking, supportedThinkingLevels(model)) as T;
}

export function withoutCatalogCredentials(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result = { ...env };
  delete result.TANGENT_MODEL_CATALOG_TOKEN;
  delete result.TANGENT_MODEL_CATALOG_URL;
  delete result.TANGENT_MODEL_CATALOG_FILE;
  delete result.TANGENT_MODEL_CATALOG_JSON;
  return result;
}

export function catalogSpawnEnv(): Record<string, string> {
  return modelCatalog
    ? { TANGENT_MODEL_CATALOG_JSON: JSON.stringify(modelCatalog) }
    : {};
}

export function remoteCatalogConfig(
  selected: string | undefined,
  thinkingDepth: ThinkingLevel | undefined,
) {
  return {
    ...(modelCatalog ? { modelCatalog } : {}),
    model: resolveCatalogModel(selected),
    thinkingDepth: resolveCatalogThinking(selected, thinkingDepth),
  };
}
