import { connectorFor, type SubagentInfo } from "@tangent/shared/contracts.ts";

import type { ConversationEventSink } from "../pi/types.ts";
import { deniedCredential } from "./credentials.ts";
import { refuseDelivery } from "./refusal.ts";
import type {
  CancelResult,
  Connector,
  DeliveryRequest,
  DeliveryResult,
} from "./types.ts";

/** Shown in the addressed conversation when no connector holds the participant. */
const NOT_AVAILABLE =
  "This agent is no longer available, so the message wasn't delivered.";

/** Why a cancellation is refused: there is no participant to cancel anything on. */
const NOT_AVAILABLE_TO_CANCEL = "This agent is no longer available.";

/**
 * The connector a registry answers with when no other one holds the
 * participant. It exists so resolution is total: an unknown id gets a refusal
 * in the conversation it was addressed to, rather than a silent fall-through
 * into whichever transport happens to be checked last.
 */
export class NullConnector implements Connector {
  readonly descriptor = connectorFor("unresolved");
  readonly acceptsDelivery = false;
  readonly credential = deniedCredential;

  private readonly handlers: ConversationEventSink;

  constructor(handlers: ConversationEventSink) {
    this.handlers = handlers;
  }

  has(): boolean {
    return false;
  }

  list(): SubagentInfo[] {
    return [];
  }

  deliver(request: DeliveryRequest): DeliveryResult {
    return refuseDelivery(this.handlers, request, NOT_AVAILABLE);
  }

  cancelRun(): CancelResult {
    // Silent, unlike a refused delivery: nothing was said, so nothing needs
    // answering in the transcript.
    return { cancelled: false, reason: NOT_AVAILABLE_TO_CANCEL };
  }

  kill(): void {}

  revive(): void {
    // Reachable only for a row whose connector kind the server no longer runs.
    // There is nothing to restore it onto, so it keeps whatever status it has.
  }
}
