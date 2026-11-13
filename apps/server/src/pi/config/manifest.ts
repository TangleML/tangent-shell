import type { BundleManifest } from "@tangent/shared/configBundle.ts";
import { ICON_FILENAME, SCHEMA_VERSION } from "@tangent/shared/configBundle.ts";
import type { MemoryBinding } from "@tangent/shared/contracts.ts";
import { THINKING_LEVELS } from "@tangent/shared/contracts.ts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { countLeaves } from "../../memory/binding.ts";

/** Pi thinking-depth levels, as a zod enum for manifest validation. */
const thinkingLevel = z.enum(THINKING_LEVELS);

/**
 * Result of {@link parseManifest}: either a validated manifest or the list of
 * problems found. `safeParse` collects every issue rather than failing on the
 * first, so authors fix a malformed `tangent.yaml` in one pass.
 */
export type ParseManifestResult =
  | { manifest: BundleManifest }
  | { errors: string[] };

/**
 * A bundle-relative path is safe when it is a non-empty relative POSIX path
 * with no `..` traversal and no absolute/drive prefix. Existence inside the zip
 * is checked later at install time (Phase 3); here we only guard the shape.
 */
function isSafeRelativePath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith("/") || /^[a-zA-Z]:/.test(value)) return false;
  return value
    .split(/[\\/]/)
    .every((segment) => segment !== ".." && segment !== "");
}

/** True when a schedule-kind trigger is missing its required schedule. */
function triggerNeedsSchedule(trigger: {
  kind: "schedule" | "callback";
  schedule?: { every?: string; cron?: string };
}): boolean {
  if (trigger.kind !== "schedule") return false;
  return !trigger.schedule?.every && !trigger.schedule?.cron;
}

/** A non-empty, bundle-relative path with no traversal. */
const safePath = z
  .string()
  .min(1)
  .refine(isSafeRelativePath, { message: "is not a safe path" });

/** True when some segment is `.qmd`; see {@link storeRoot}. */
function hasQmdSegment(value: string): boolean {
  return value.split(/[\\/]/).includes(".qmd");
}

/**
 * A memory store `root`. The store's qmd config dir mirrors this path, and qmd
 * treats a config dir named `.qmd` as project-local and trust-gates its
 * collection, which would silently empty the store's search.
 */
const storeRoot = safePath.refine((value) => !hasQmdSegment(value), {
  message: "must not contain a .qmd segment",
});

/** A global-extension id slug (matches the install registry's id rule). */
const extensionId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, {
  message: "must be a slug matching ^[a-z0-9][a-z0-9-]*$",
});

/**
 * Validator for a bundle's `globalExtensions` opt-in policy: `"all"`, a list of
 * extension ids the session may extend, or `{ only: [...] }` the session may not
 * override. Mirrors the shared {@link
 * import("@tangent/shared/contracts.ts").BundleExtensionPolicy} type.
 */
const globalExtensionPolicySchema = z.union([
  z.literal("all"),
  z.array(extensionId),
  z.object({ only: z.array(extensionId) }),
]);

/** Tunable knobs for a `pi-memory` {@link MemoryBinding}. */
const piMemoryConfigSchema = z.object({
  exitSummary: z.boolean().optional(),
  snapshot: z.enum(["stable", "per-turn"]).optional(),
  qmdUpdate: z.enum(["background", "manual", "off"]).optional(),
  search: z.boolean().optional(),
  exitSummaryModel: z.string().min(1).optional(),
});

const memoryBindingNodeSchema: z.ZodType<MemoryBinding> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("simple-md"), root: storeRoot.optional() }),
    z.object({
      kind: z.literal("pi-memory"),
      root: storeRoot.optional(),
      config: piMemoryConfigSchema.optional(),
    }),
    z.object({ kind: z.literal("bundle-kb") }),
    z.object({
      kind: z.literal("composite"),
      children: z.array(memoryBindingNodeSchema),
    }),
  ]),
);

/**
 * Validator for a {@link MemoryBinding}, shared by the bundle manifest and the
 * create-session route. `root` is a session-root-relative store directory. One
 * Pi process loads the pi-memory extension once, bound to one `PI_MEMORY_DIR`,
 * so a binding may hold at most one `pi-memory` leaf. A session belongs to one
 * bundle, so it may hold at most one `bundle-kb` leaf too.
 */
export const memoryBindingSchema: z.ZodType<MemoryBinding> =
  memoryBindingNodeSchema
    .refine((binding) => countLeaves(binding, "pi-memory") <= 1, {
      message: "a memory binding may contain at most one pi-memory store",
    })
    .refine((binding) => countLeaves(binding, "bundle-kb") <= 1, {
      message: "a memory binding may contain at most one bundle-kb store",
    });

/**
 * zod schema mirroring {@link BundleManifest}. Used in place of the prior
 * hand-rolled validator: it declares required fields, the `id` slug rule, the
 * `schemaVersion` literal, and the safe-path guard on every referenced path.
 * A compile-time check (`schemaOutput`) keeps it aligned with the shared type.
 */
const manifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, {
    message: "must be a slug matching ^[a-z0-9][a-z0-9-]*$",
  }),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  icon: safePath.default(ICON_FILENAME),
  tags: z.array(z.string()).optional(),
  prime: z.object({
    systemPrompt: safePath,
    tools: z.array(z.string()).optional(),
    welcomeMessage: safePath.optional(),
    model: z.string().min(1).optional(),
    thinking: thinkingLevel.optional(),
  }),
  subagents: z
    .object({
      defaultSystemPrompt: safePath.optional(),
      defaultTools: z.array(z.string()).optional(),
      defaultModel: z.string().min(1).optional(),
      defaultThinking: thinkingLevel.optional(),
    })
    .optional(),
  skills: z.array(safePath).optional(),
  workflows: z.array(safePath).optional(),
  agents: z.array(safePath).optional(),
  contextFiles: z.array(safePath).optional(),
  memory: z.array(safePath).optional(),
  memoryBinding: memoryBindingSchema.optional(),
  extensions: z.array(safePath).optional(),
  globalExtensions: globalExtensionPolicySchema.optional(),
  software: z.record(z.string().min(1), z.array(z.string().min(1))).optional(),
  ui: z
    .object({
      components: z
        .array(
          z.object({
            name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, {
              message: "must be a slug matching ^[a-z0-9][a-z0-9-]*$",
            }),
            kind: z.enum(["message", "panel"]),
            entry: safePath,
            title: z.string().min(1).optional(),
          }),
        )
        .superRefine((components, ctx) => {
          const seen = new Set<string>();
          components.forEach((component, index) => {
            if (seen.has(component.name)) {
              ctx.addIssue({
                code: "custom",
                path: [index, "name"],
                message: `duplicate component name "${component.name}"`,
              });
            }
            seen.add(component.name);
          });
        }),
    })
    .optional(),
  triggers: z
    .array(
      z
        .object({
          name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, {
            message: "must be a slug matching ^[a-z0-9][a-z0-9-]*$",
          }),
          kind: z.enum(["schedule", "callback"]),
          title: z.string().min(1).optional(),
          prompt: z.string().min(1).optional(),
          handler: safePath.optional(),
          schedule: z
            .object({
              every: z.string().min(1).optional(),
              cron: z.string().min(1).optional(),
            })
            .optional(),
          enabled: z.boolean().optional(),
        })
        .superRefine((trigger, ctx) => {
          if (!trigger.prompt && !trigger.handler) {
            ctx.addIssue({
              code: "custom",
              path: ["prompt"],
              message: "a trigger must define `prompt` or `handler`",
            });
          }
          if (triggerNeedsSchedule(trigger)) {
            ctx.addIssue({
              code: "custom",
              path: ["schedule"],
              message:
                "schedule triggers require `schedule.every` or `schedule.cron`",
            });
          }
        }),
    )
    .superRefine((triggers, ctx) => {
      const seen = new Set<string>();
      triggers.forEach((trigger, index) => {
        if (seen.has(trigger.name)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "name"],
            message: `duplicate trigger name "${trigger.name}"`,
          });
        }
        seen.add(trigger.name);
      });
    })
    .optional(),
});

/** Compile-time guard that the schema output stays assignable to the contract. */
type SchemaOutput = z.infer<typeof manifestSchema>;
const _schemaMatchesContract: (x: SchemaOutput) => BundleManifest = (x) => x;
void _schemaMatchesContract;

/**
 * Parses and validates the text of a `tangent.yaml` manifest. Returns the
 * coerced {@link BundleManifest} on success, or a flat list of human-readable
 * errors (`tangent.yaml: "<path>" <message>`). YAML syntax errors are surfaced
 * as a single parse error.
 */
export function parseManifest(yamlText: string): ParseManifestResult {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { errors: [`tangent.yaml: ${message}`] };
  }

  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return path
        ? `tangent.yaml: "${path}" ${issue.message}`
        : `tangent.yaml: ${issue.message}`;
    });
    return { errors };
  }
  return { manifest: result.data };
}
