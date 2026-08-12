import { PI_AGENT } from "@tangent/shared/contracts";

import type { ChatMessage } from "@/features/chat/model/types";

/**
 * How a message written from another conversation is labelled, so a report
 * arriving from elsewhere reads differently from a peer turn in this thread.
 * Only the orchestrator's thread can be named without the roster; any other
 * origin is stated without being resolved rather than shown as a raw id.
 */
export function originLabelFor(message: ChatMessage): string | undefined {
  const origin = message.source.fromConversation;
  if (!origin) return undefined;
  if (origin === PI_AGENT.id) return `from ${PI_AGENT.name}'s thread`;
  return "from another thread";
}
