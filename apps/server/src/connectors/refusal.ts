import { SYSTEM_AUTHOR } from "@tangent/shared/contracts.ts";

import type { ConversationEventSink } from "../pi/types.ts";
import type { DeliveryRequest, DeliveryResult } from "./types.ts";

/**
 * Refuses a delivery and says so in the conversation it was aimed at, rather
 * than in Prime's. The sender learns from the result; the user sees the reason
 * in the thread where the message was meant to land.
 */
export function refuseDelivery(
  handlers: ConversationEventSink,
  request: DeliveryRequest,
  reason: string,
): DeliveryResult {
  handlers.onAgentMessage({
    sessionId: request.sessionId,
    conversationId: request.conversationId ?? request.participantId,
    author: SYSTEM_AUTHOR,
    content: reason,
  });
  return { delivered: false, reason };
}
