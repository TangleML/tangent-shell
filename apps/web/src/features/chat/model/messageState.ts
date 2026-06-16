import type { ChatMessage } from "./types";

/**
 * A message whose only payload is the agent's reasoning (no answer text, no
 * attachments). These are intermediate "thinking" steps and collapse by default
 * in the transcript.
 */
export function isThinkingOnly(message: ChatMessage): boolean {
  return (
    message.author.kind === "agent" &&
    Boolean(message.thinking?.trim()) &&
    !message.content.trim() &&
    !message.attachments?.length
  );
}
