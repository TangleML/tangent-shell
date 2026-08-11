import { connectorFor, type SubagentInfo } from "@tangent/shared/contracts.ts";

import type { PiAgentHandlers } from "../pi/types.ts";
import { refuseDelivery } from "./refusal.ts";
import type { Connector, DeliveryRequest, DeliveryResult } from "./types.ts";

/** Shown in the addressed conversation when no connector holds the participant. */
const NOT_AVAILABLE =
  "This agent is no longer available, so the message wasn't delivered.";

/**
 * The connector a registry answers with when no other one holds the
 * participant. It exists so resolution is total: an unknown id gets a refusal
 * in the conversation it was addressed to, rather than a silent fall-through
 * into whichever transport happens to be checked last.
 */
export class NullConnector implements Connector {
  readonly descriptor = connectorFor("unresolved");
  readonly acceptsDelivery = false;

  private readonly handlers: PiAgentHandlers;

  constructor(handlers: PiAgentHandlers) {
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

  kill(): void {}
}
