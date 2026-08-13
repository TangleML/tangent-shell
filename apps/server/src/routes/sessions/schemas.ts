import { THINKING_LEVELS } from "@tangent/shared/contracts.ts";
import { z } from "zod";

export const createSessionSchema = z.object({
  name: z.string().optional(),
  bundleId: z.string().min(1),
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

/** Revival spec for a `subagent`-target trigger's dedicated sub-agent. */
const triggerSubagentSchema = z.object({
  name: z.string().optional(),
  template: z.string().optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
  thinkingDepth: z.enum(THINKING_LEVELS).optional(),
});

/** Create-trigger body; kept compatible with the shared `CreateTriggerRequest`. */
export const createTriggerSchema = z.object({
  name: z.string(),
  kind: z.enum(["schedule", "callback"]),
  title: z.string().optional(),
  prompt: z.string().optional(),
  schedule: triggerScheduleSchema.optional(),
  enabled: z.boolean().optional(),
  target: z.enum(["prime", "subagent"]).optional(),
  subagent: triggerSubagentSchema.optional(),
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

/**
 * Invite-participant body. The email is the person's server-resolved id, so it
 * matches the id their connected socket already authors under.
 */
export const inviteParticipantSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  conversationIds: z.array(z.string()).optional(),
});
export type InviteParticipantInput = z.infer<typeof inviteParticipantSchema>;

/** `:id/:participantId` route params for participant management. */
export const participantParamsSchema = z.object({
  id: z.string(),
  participantId: z.string(),
});
export type ParticipantParams = z.infer<typeof participantParamsSchema>;

/** Join-membership body: the Conversation to grant Membership in. */
export const joinMembershipSchema = z.object({
  conversationId: z.string().min(1),
});
export type JoinMembershipInput = z.infer<typeof joinMembershipSchema>;

/** `:id/:participantId/memberships/:conversationId` route params. */
export const membershipParamsSchema = z.object({
  id: z.string(),
  participantId: z.string(),
  conversationId: z.string(),
});
export type MembershipParams = z.infer<typeof membershipParamsSchema>;

/** Mute/unmute body. */
export const muteMembershipSchema = z.object({
  muted: z.boolean(),
});
export type MuteMembershipInput = z.infer<typeof muteMembershipSchema>;
