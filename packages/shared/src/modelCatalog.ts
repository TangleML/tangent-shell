import { z } from "zod";

import { THINKING_LEVELS, type ThinkingLevel } from "./contracts.ts";

const effort = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const thinkingMap = z
  .object({
    off: effort.nullable(),
    minimal: effort.nullable(),
    low: effort.nullable(),
    medium: effort.nullable(),
    high: effort.nullable(),
    xhigh: effort.nullable(),
    max: effort.nullable(),
  })
  .strict();
const modelSchema = z
  .object({
    id: z.string().min(1).regex(/^\S+$/),
    label: z.string().min(1),
    tangentModelId: z.string().regex(/^[a-zA-Z0-9_-]+\/.+$/),
    api: z.enum([
      "openai-responses",
      "anthropic-messages",
      "openai-completions",
    ]),
    browserAvailable: z.boolean().default(true),
    reasoningEfforts: z.array(effort),
    input: z.array(z.enum(["text", "image"])).min(1),
    contextWindow: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    thinkingLevelMap: thinkingMap,
  })
  .strict()
  .refine(
    (m) => m.tangentModelId.slice(m.tangentModelId.indexOf("/") + 1) === m.id,
    "Mismatched model ID",
  )
  .refine((m) => m.maxOutputTokens <= m.contextWindow, "Output exceeds context")
  .refine(
    (m) =>
      Object.values(m.thinkingLevelMap)
        .filter((e) => e !== null)
        .every((e) => m.reasoningEfforts.includes(e)),
    "Unsupported thinking mapping",
  );
const catalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    defaults: z
      .object({
        browser: z.string(),
        tangent: z.string(),
        orchestrator: z.string(),
        subagent: z.string(),
        embedding: z.string().min(1),
      })
      .strict(),
    replacements: z.record(z.string(), z.string()),
    models: z.array(modelSchema).min(1),
  })
  .strict();
export type CatalogModel = z.infer<typeof modelSchema>;
export type ModelCatalog = z.infer<typeof catalogSchema>;

function validateReferences(catalog: ModelCatalog): void {
  const ids = new Set(catalog.models.map((m) => m.id));
  const selections = new Set(catalog.models.map((m) => m.tangentModelId));
  if (
    ids.size !== catalog.models.length ||
    selections.size !== catalog.models.length
  )
    throw new Error("Duplicate catalog model");
  const defaults = [
    catalog.defaults.browser,
    catalog.defaults.orchestrator,
    catalog.defaults.subagent,
    ...Object.values(catalog.replacements),
  ];
  if (
    !defaults.every((id) => ids.has(id)) ||
    !selections.has(catalog.defaults.tangent)
  )
    throw new Error("Invalid catalog defaults");
  const protocols = new Map<string, string>();
  for (const model of catalog.models) {
    const provider = model.tangentModelId.split("/")[0];
    const previous = protocols.get(provider);
    if (previous && previous !== model.api)
      throw new Error("Catalog provider mixes protocols");
    protocols.set(provider, model.api);
  }
}

/** Only data fields: executable commands, URLs and credentials are rejected. */
export function parseModelCatalog(value: unknown): ModelCatalog {
  const catalog = catalogSchema.parse(value);
  validateReferences(catalog);
  return catalog;
}

/**
 * Matches a stored selection to a catalog model. Selections predating the
 * catalog are `provider/model` ids from {@link AVAILABLE_MODELS}, so the
 * provider prefix is ignored and stale ids go through `replacements`.
 */
export function findCatalogModel(
  catalog: ModelCatalog,
  selected: string,
): CatalogModel | undefined {
  const trimmed = selected.trim();
  const bare = trimmed.slice(trimmed.indexOf("/") + 1);
  const id = catalog.replacements[bare] ?? bare;
  return catalog.models.find((m) => m.id === id);
}

/** The `tangentModelId` to run, falling back to the catalog's Tangent default. */
export function resolveCatalogSelection(
  catalog: ModelCatalog,
  selected: string | undefined,
): string {
  return (
    (selected && findCatalogModel(catalog, selected)?.tangentModelId) ||
    catalog.defaults.tangent
  );
}

export function supportedThinkingLevels(model: CatalogModel): ThinkingLevel[] {
  return THINKING_LEVELS.filter(
    (level) => model.thinkingLevelMap[level] != null,
  );
}

/** The supported level closest to `wanted`, preferring the shallower one on a tie. */
export function nearestThinkingLevel(
  wanted: ThinkingLevel,
  supported: readonly ThinkingLevel[],
): ThinkingLevel {
  const index = THINKING_LEVELS.indexOf(wanted);
  const distance = (level: ThinkingLevel) =>
    Math.abs(THINKING_LEVELS.indexOf(level) - index);
  return [...supported].sort((a, b) => distance(a) - distance(b))[0] ?? wanted;
}
