import { PI_AGENT } from "@tangent/shared/contracts";

import type { ChatMessage } from "@/features/chat/model/types";

/**
 * How a message written from another conversation is labelled, so a report
 * arriving from elsewhere reads differently from a peer turn in this thread.
 * Only the orchestrator's thread can be named without the roster; any other
 * origin is stated without being resolved rather than shown as a raw id. The
 * orchestrator's home Conversation is server-derived (`primaryConversationId`),
 * no longer the reserved `"prime"` id.
 */
export function originLabelFor(
  message: ChatMessage,
  primaryConversationId: string,
): string | undefined {
  const origin = message.source.fromConversation;
  if (!origin) return undefined;
  if (origin === primaryConversationId) return `from ${PI_AGENT.name}'s thread`;
  return "from another thread";
}
