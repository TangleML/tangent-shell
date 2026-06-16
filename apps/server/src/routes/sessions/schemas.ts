import { z } from "zod";

/**
 * Create-session body. Every field is optional so a multipart request (the
 * `config` ZIP upload, whose form fields land in `req.body`) still validates;
 * the uploaded file itself is read from `req.file`, not from the body.
 */
export const createSessionSchema = z.object({
  name: z.string().optional(),
  bundleId: z.string().optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

/** Update-session body. */
export const updateSessionSchema = z.object({
  name: z.string().optional(),
  archived: z.boolean().optional(),
});
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

/** `:id` route param shared by the single-session routes. */
export const sessionParamsSchema = z.object({
  id: z.string(),
});
export type SessionParams = z.infer<typeof sessionParamsSchema>;

const triggerScheduleSchema = z.object({
  every: z.string().optional(),
  cron: z.string().optional(),
});

/** Create-trigger body; kept compatible with the shared `CreateTriggerRequest`. */
export const createTriggerSchema = z.object({
  name: z.string(),
  kind: z.enum(["schedule", "callback"]),
  title: z.string().optional(),
  prompt: z.string().optional(),
  schedule: triggerScheduleSchema.optional(),
  enabled: z.boolean().optional(),
});
export type CreateTriggerInput = z.infer<typeof createTriggerSchema>;

/** Update-trigger body; kept compatible with the shared `UpdateTriggerRequest`. */
export const updateTriggerSchema = z.object({
  enabled: z.boolean().optional(),
  prompt: z.string().optional(),
  title: z.string().optional(),
  schedule: triggerScheduleSchema.optional(),
});
export type UpdateTriggerInput = z.infer<typeof updateTriggerSchema>;

/** `:id/:triggerId` route params for trigger management. */
export const triggerParamsSchema = z.object({
  id: z.string(),
  triggerId: z.string(),
});
export type TriggerParams = z.infer<typeof triggerParamsSchema>;

/**
 * Callback route params (adds the per-trigger secret). Used to type the
 * callback handler's `Request` generic; the handler keeps its own `isUnsafeId`
 * traversal guard rather than routing params through `validate`.
 */
export const callbackParamsSchema = z.object({
  id: z.string(),
  triggerId: z.string(),
  secret: z.string(),
});
export type CallbackParams = z.infer<typeof callbackParamsSchema>;
