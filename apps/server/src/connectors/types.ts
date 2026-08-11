import type {
  ChatAuthor,
  ConnectorDescriptor,
  MessageDelivery,
  SubagentInfo,
} from "@tangent/shared/contracts.ts";

import type { SubagentSpawnRequest } from "../pi/agentConfig.ts";
import type { SpawnedSubagent } from "../pi/piAgentManager.ts";

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
}

/** What became of a delivery. `reason` is set only when it was refused. */
export interface DeliveryResult {
  delivered: boolean;
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
 * mis-delivery — and the tree has had both.
 */
export interface Connector {
  readonly descriptor: ConnectorDescriptor;
  /** Whether this connector can carry a message to its participants at all. */
  readonly acceptsDelivery: boolean;
  has(sessionId: string, participantId: string): boolean;
  list(sessionId: string): SubagentInfo[];
  deliver(request: DeliveryRequest): DeliveryResult;
  /** Present only where {@link ConnectorDescriptor.spawnAuthority} allows it. */
  spawn?(sessionId: string, request: SubagentSpawnRequest): SpawnedSubagent;
  kill(sessionId: string, participantId: string, completed: boolean): void;
  /** Restores a participant after a restart. PR 1.4 fills this in. */
  revive?(sessionId: string, participantId: string): void;
}
