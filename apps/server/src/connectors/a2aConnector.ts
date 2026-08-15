import { connectorFor } from "@tangent/shared/contracts.ts";

import type { A2aPeerGateway } from "../a2a/a2aPeerGateway.ts";
import type { ConversationEventSink } from "../pi/types.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import { a2aCredential } from "./credentials.ts";
import { refuseDelivery } from "./refusal.ts";
import type {
  CancelResult,
  Connector,
  DeliveryRequest,
  DeliveryResult,
  RunCancellation,
} from "./types.ts";

/** Shown in the peer's own thread when this gateway no longer holds it. */
const NOT_ATTACHED =
  "This agent is no longer attached to the session, so the message wasn't delivered.";

/** Why a cancellation was refused: the peer had nothing open for us. */
const NOTHING_RUNNING = "That agent isn't running anything right now.";

/**
 * The connector for attached A2A agents: heterogeneous agents reached over the
 * A2A protocol, which Tangent dials rather than runs. A thin adapter over {@link
 * A2aPeerGateway}.
 *
 * It has no `spawn`. An A2A agent exists before Tangent hears of it and outlives
 * every session that talks to it, so there is nothing to create — discovering an
 * Agent Card is what attaching means, and `spawnAuthority: "none"` says so.
 * `kill` ends the attachment for the same reason: the far end is not ours to
 * end.
 *
 * Delivery is synchronous by declaration and asynchronous in fact: the gateway
 * opens the Run and returns, and a peer that turns out to be unreachable
 * explains itself in its own thread rather than making the sender wait to find
 * out.
 */
export class A2aConnector implements Connector {
  readonly descriptor = connectorFor("a2a");
  readonly acceptsDelivery = true;
  readonly credential = a2aCredential;

  private readonly gateway: A2aPeerGateway;
  private readonly handlers: ConversationEventSink;

  constructor(gateway: A2aPeerGateway, handlers: ConversationEventSink) {
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
    const delivered = this.gateway.send({
      sessionId: request.sessionId,
      participantId: request.participantId,
      text: request.text,
      ingress: request.ingress,
      conversationId: request.conversationId,
    });
    if (delivered) return { delivered: true };
    return refuseDelivery(this.handlers, request, NOT_ATTACHED);
  }

  cancelRun(request: RunCancellation): CancelResult {
    // A2A cancellation targets the Task, and a participant has at most one Run
    // open, so cancelling that Run is cancelling the Task behind it.
    const cancelled = this.gateway.cancel(
      request.sessionId,
      request.participantId,
    );
    if (cancelled) return { cancelled: true };
    return { cancelled: false, reason: NOTHING_RUNNING };
  }

  kill(sessionId: string, participantId: string, completed: boolean): void {
    this.gateway.detach(sessionId, participantId, completed);
  }

  revive(sessionId: string, agent: SessionAgent): void {
    // Tangent is the client here, so there is nothing to wait to be reattached
    // by: the tab comes back `detached` from the address the row kept, and the
    // next delivery re-discovers the peer.
    this.gateway.reattach(sessionId, agent);
  }
}
