import { connectorFor } from "@tangent/shared/contracts.ts";

import type { SubagentSpawnRequest } from "../pi/agentConfig.ts";
import type { PiAgentManager, SpawnedSubagent } from "../pi/piAgentManager.ts";
import type { Connector, DeliveryRequest, DeliveryResult } from "./types.ts";

/**
 * The connector for agents running as `pi` child processes the server owns —
 * every session's Prime and its local sub-agents. A thin adapter over {@link
 * PiAgentManager}, which is unchanged.
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
    );
    return { delivered: true };
  }

  spawn(sessionId: string, request: SubagentSpawnRequest): SpawnedSubagent {
    return this.pi.spawnSubagent(sessionId, request);
  }

  kill(sessionId: string, participantId: string, completed: boolean): void {
    this.pi.killAgent(sessionId, participantId, completed);
  }
}
