import type {
  ChatAuthor,
  ConnectorDescriptor,
  MessageDelivery,
  RunId,
  RunIngress,
  SubagentInfo,
} from "@tangent/shared/contracts.ts";

import type { SubagentSpawnRequest } from "../pi/agentConfig.ts";
import type { SpawnedSubagent } from "../pi/piAgentManager.ts";
import type { SessionAgent } from "../store/sessionStore.ts";

/** A message addressed to one participant, as a connector receives it. */
export interface DeliveryRequest {
  sessionId: string;
  participantId: string;
  text: string;
  /**
   * Surfaces the message in the participant's own transcript attributed to this
   * author. Omitted by internal relays, which are already surfaced elsewhere.
   */
  surfaceAuthor?: ChatAuthor;
  delivery?: MessageDelivery;
  /**
   * What this delivery counts as when it starts a Run. Defaults to `reaction`,
   * which is what a message from a human or another participant is.
   */
  ingress?: RunIngress;
}

/** What became of a delivery. `reason` is set only when it was refused. */
export interface DeliveryResult {
  delivered: boolean;
  reason?: string;
}

/** A request to stop one participant's in-progress work. */
export interface RunCancellation {
  sessionId: string;
  participantId: string;
  /** The Run to cancel; the connector resolves the open one when omitted. */
  runId?: RunId;
}

/**
 * What became of a cancellation. `reason` is set only when it was refused —
 * because the transport has no cancel protocol, or because there was nothing
 * running to cancel.
 */
export interface CancelResult {
  cancelled: boolean;
  reason?: string;
}

/**
 * One way of reaching participants: a transport plus the roster of participants
 * it currently holds. A registry resolves a participant to exactly one of
 * these, so every caller routes through the same lookup instead of re-deriving
 * the transport from a host label.
 *
 * `deliver` is required of every connector. One that cannot accept a message
 * declares {@link Connector.acceptsDelivery} false and refuses, because an
 * absent method is a compile-time refusal while an untaken branch is a runtime
 * mis-delivery — and the tree has had both. `cancelRun` and `revive` follow the
 * same rule: a transport with no cancel protocol, or no way to bring a
 * participant back, says so by declaration.
 */
export interface Connector {
  readonly descriptor: ConnectorDescriptor;
  /** Whether this connector can carry a message to its participants at all. */
  readonly acceptsDelivery: boolean;
  has(sessionId: string, participantId: string): boolean;
  list(sessionId: string): SubagentInfo[];
  deliver(request: DeliveryRequest): DeliveryResult;
  /** Stops a participant's in-progress Run, or says why it cannot. */
  cancelRun(request: RunCancellation): CancelResult;
  /** Present only where {@link ConnectorDescriptor.spawnAuthority} allows it. */
  spawn?(sessionId: string, request: SubagentSpawnRequest): SpawnedSubagent;
  kill(sessionId: string, participantId: string, completed: boolean): void;
  /**
   * Restores one persisted participant after a restart. What that means is the
   * connector's to decide: re-spawning the process it owns, or restoring the
   * roster entry as `detached` and waiting for the far end to come back.
   */
  revive(sessionId: string, agent: SessionAgent): void;
}
