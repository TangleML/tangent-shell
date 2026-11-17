import { readFile } from "node:fs/promises";

import {
  type ModelCatalog,
  parseModelCatalog,
} from "@tangent/shared/modelCatalog.ts";

function catalogUrl(value: string): URL {
  const parsed = new URL(value);
  const loopback = ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.username || parsed.password)
    throw new Error("Catalog URL must not contain credentials");
  if (parsed.protocol === "https:") return parsed;
  if (parsed.protocol === "http:" && loopback) return parsed;
  throw new Error("Catalog URL requires HTTPS");
}

async function fetchCatalog(url: string): Promise<ModelCatalog> {
  const token = process.env.TANGENT_MODEL_CATALOG_TOKEN;
  const response = await fetch(catalogUrl(url), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  if (!selected) return modelCatalog.defaults.tangent;
  const bare = bareModelId(selected);
  const id = modelCatalog.replacements[bare] ?? bare;
  const model = modelCatalog.models.find((m) => m.id === id);
  return model?.tangentModelId ?? selected;
}

function bareModelId(selected: string): string {
  return selected.includes("/")
    ? selected.slice(selected.indexOf("/") + 1)
    : selected;
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

export function remoteCatalogConfig(selected?: string) {
  return {
    ...(modelCatalog ? { modelCatalog } : {}),
    model: resolveCatalogModel(selected),
  };
}
