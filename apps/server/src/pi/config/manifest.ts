import type { BundleManifest } from "@tangent/shared/configBundle.ts";
import { ICON_FILENAME, SCHEMA_VERSION } from "@tangent/shared/configBundle.ts";
import { THINKING_LEVELS } from "@tangent/shared/contracts.ts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

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
  extensions: z.array(safePath).optional(),
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
