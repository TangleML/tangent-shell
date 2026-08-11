import { connectorFor } from "@tangent/shared/contracts.ts";

import type { ExternalSubagentGateway } from "../external/externalSubagentGateway.ts";
import type { PiAgentHandlers } from "../pi/types.ts";
import { refuseDelivery } from "./refusal.ts";
import type { Connector, DeliveryRequest, DeliveryResult } from "./types.ts";

/** Shown in the sub-agent's own thread when a message cannot reach it. */
const NO_INBOUND_CHANNEL =
  "This sub-agent runs outside Tangent, so it can't receive messages here.";

/**
 * The connector for external sub-agent tabs, whose work runs outside Tangent
 * and streams in over the internal external-agents API. A thin adapter over
 * {@link ExternalSubagentGateway}, which is unchanged.
 *
 * Traffic is inbound only: the driving bundle tool owns the far side, so there
 * is no channel to deliver a message back over. That is declared rather than
 * left to a missing method, so a message aimed here is refused in this tab
 * instead of falling through to the local agent map.
 */
export class ExternalConnector implements Connector {
  readonly descriptor = connectorFor("external-inbound");
  readonly acceptsDelivery = false;

  private readonly gateway: ExternalSubagentGateway;
  private readonly handlers: PiAgentHandlers;

  constructor(gateway: ExternalSubagentGateway, handlers: PiAgentHandlers) {
    this.gateway = gateway;
    this.handlers = handlers;
  }

  has(sessionId: string, participantId: string): boolean {
    return this.gateway.hasAgent(sessionId, participantId);
  }

  list(sessionId: string) {
    return this.gateway.listSubagents(sessionId);
  }

  deliver(request: DeliveryRequest): DeliveryResult {
    return refuseDelivery(this.handlers, request, NO_INBOUND_CHANNEL);
  }

  kill(sessionId: string, participantId: string, completed: boolean): void {
    this.gateway.setStatus(
      sessionId,
      participantId,
      completed ? "completed" : "killed",
    );
  }
}
