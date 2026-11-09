import { z } from "zod";

import { tagsSchema, titleSchema } from "./memoryDigest.ts";

const scopeSchema = z.enum(["session", "global"]);
const factTextSchema = z.string().trim().min(1, "text must not be empty");

export const readMemoryParamsSchema = z.object({
  scope: scopeSchema.optional(),
  entry: z.string().trim().min(1).optional(),
});

export const rememberParamsSchema = z.object({
  title: titleSchema,
  text: factTextSchema,
  tags: tagsSchema,
  scope: scopeSchema.optional(),
  replaces: z.string().optional(),
});

export const suggestParamsSchema = z.object({
  title: titleSchema,
  text: factTextSchema,
  scope: scopeSchema.optional(),
});
