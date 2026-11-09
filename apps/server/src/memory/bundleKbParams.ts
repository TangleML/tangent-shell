import { z } from "zod";

import { tagsSchema, titleSchema } from "./memoryDigest.ts";
import type { QmdHit } from "./qmdRunner.ts";

export const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 20;
const MAX_HIT_CHARS = 800;
const MIN_FORGET_MATCH = 4;

export const searchParamsSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "query must not be empty")
    .refine((query) => !query.startsWith("-"), "query must not start with '-'"),
  mode: z.enum(["keyword", "semantic", "deep"]).optional(),
  limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
});

export const readParamsSchema = z.object({
  path: z.string().trim().min(1).optional(),
  entry: z.string().trim().min(1).optional(),
});

export const writeParamsSchema = z.object({
  title: titleSchema,
  content: z.string().trim().min(1, "content must not be empty"),
  target: z.enum(["long_term", "daily"]).optional(),
  tags: tagsSchema,
});

export const forgetParamsSchema = z.object({
  match: z
    .string()
    .trim()
    .min(
      MIN_FORGET_MATCH,
      `match must be at least ${MIN_FORGET_MATCH} characters`,
    ),
});

/** One numbered search hit for the agent, its text capped. */
export function formatHit(hit: QmdHit, index: number): string {
  const score = hit.score === undefined ? "" : ` (score ${hit.score})`;
  const text =
    hit.text.length > MAX_HIT_CHARS
      ? `${hit.text.slice(0, MAX_HIT_CHARS).trimEnd()} …`
      : hit.text;
  return [`${index + 1}. \`${hit.path}\`${score}`, "", text].join("\n");
}
