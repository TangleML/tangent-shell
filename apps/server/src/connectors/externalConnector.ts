import { connectorFor } from "@tangent/shared/contracts.ts";

import type { ExternalSubagentGateway } from "../external/externalSubagentGateway.ts";
import type { ConversationEventSink } from "../pi/types.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import { externalCredential } from "./credentials.ts";
import { refuseDelivery } from "./refusal.ts";
import type {
  CancelResult,
  Connector,
  DeliveryRequest,
  DeliveryResult,
} from "./types.ts";

/** Shown in the sub-agent's own thread when nothing is driving its far side. */
const NOT_BEING_DRIVEN =
  "This sub-agent's far side isn't being driven right now, so the message " +
  "wasn't carried to it.";

/** Why a cancellation is refused: the driver owns the turn, not the server. */
const NO_CANCEL_CHANNEL =
  "This sub-agent runs outside Tangent, so its work can't be stopped from here.";

/**
 * The connector for external sub-agent tabs, whose work runs outside Tangent
 * and streams in over the internal external-agents API. A thin adapter over
 * {@link ExternalSubagentGateway}, which holds both directions of the transport.
 *
 * Delivery is accepted: a message is queued for the driver that owns the far
 * side and carried on its next poll, so an external participant is reached by
 * being addressed like any other. Whether that driver streams or polls is
 * invisible from here. Cancellation is still refused — the driver, not the
 * server, holds the turn.
 */
export class ExternalConnector implements Connector {
  readonly descriptor = connectorFor("external-inbound");
  readonly acceptsDelivery = true;
  readonly credential = externalCredential;

  private readonly gateway: ExternalSubagentGateway;
  private readonly handlers: ConversationEventSink;

  constructor(
    gateway: ExternalSubagentGateway,
    handlers: ConversationEventSink,
  ) {
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
    const queued = this.gateway.deliver(
      request.sessionId,
      request.participantId,
      request.text,
    );
    if (!queued) {
      return refuseDelivery(this.handlers, request, NOT_BEING_DRIVEN);
    }
    return { delivered: true };
  }

  cancelRun(): CancelResult {
    return { cancelled: false, reason: NO_CANCEL_CHANNEL };
  }

  kill(sessionId: string, participantId: string, completed: boolean): void {
    this.gateway.setStatus(
      sessionId,
      participantId,
      completed ? "completed" : "killed",
    );
  }

  revive(sessionId: string, agent: SessionAgent): void {
    // Nothing here creates the far side — the bundle tool driving it does — so
    // the tab comes back `detached` and the next turn pushed into it reattaches.
    this.gateway.reattach(sessionId, agent);
  }
}
