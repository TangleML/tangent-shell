import { connectorFor } from "@tangent/shared/contracts.ts";

import type { SubagentSpawnRequest } from "../pi/agentConfig.ts";
import type { PiAgentManager, SpawnedSubagent } from "../pi/piAgentManager.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import type {
  CancelResult,
  Connector,
  DeliveryRequest,
  DeliveryResult,
  RunCancellation,
} from "./types.ts";

/** Why a cancellation was refused when the participant was already idle. */
const NOTHING_RUNNING = "That agent isn't running anything right now.";

/**
 * The connector for agents running as `pi` child processes the server owns —
 * every session's Prime and its local sub-agents. A thin adapter over {@link
 * PiAgentManager}, which owns its own run boundaries.
 */
export class PiConnector implements Connector {
  readonly descriptor = connectorFor("pi-stdio");
  readonly acceptsDelivery = true;

  private readonly pi: PiAgentManager;

  constructor(pi: PiAgentManager) {
    this.pi = pi;
  }

  has(sessionId: string, participantId: string): boolean {
    return this.pi.hasAgent(sessionId, participantId);
  }

  list(sessionId: string) {
    return this.pi.listSubagents(sessionId);
  }

  deliver(request: DeliveryRequest): DeliveryResult {
    this.pi.sendToAgent(
      request.sessionId,
      request.participantId,
      request.text,
      request.surfaceAuthor,
      request.delivery,
      request.ingress,
    );
    return { delivered: true };
  }

  cancelRun(request: RunCancellation): CancelResult {
    // Pi's abort RPC targets the process, not a run id: the participant has at
    // most one Run open, so cancelling it is cancelling that Run.
    const cancelled = this.pi.abort(request.sessionId, request.participantId);
    if (cancelled) return { cancelled: true };
    return { cancelled: false, reason: NOTHING_RUNNING };
  }

  spawn(sessionId: string, request: SubagentSpawnRequest): SpawnedSubagent {
    return this.pi.spawnSubagent(sessionId, request);
  }

  kill(sessionId: string, participantId: string, completed: boolean): void {
    this.pi.killAgent(sessionId, participantId, completed);
  }

  revive(sessionId: string, agent: SessionAgent): void {
    // The server owns the process, so restoring the participant is re-spawning
    // it from the config the row kept.
    this.pi.reviveSubagent(sessionId, agent);
  }
}
