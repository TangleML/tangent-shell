import { connectorFor } from "@tangent/shared/contracts.ts";

import type { SubagentSpawnRequest } from "../pi/agentConfig.ts";
import type { SpawnedSubagent } from "../pi/piAgentManager.ts";
import type { RemoteEnvironmentGateway } from "../remote/remoteEnvironmentGateway.ts";
import type { Connector, DeliveryRequest, DeliveryResult } from "./types.ts";

/**
 * The connector for sub-agents hosted inside a connected remote environment. A
 * thin adapter over {@link RemoteEnvironmentGateway}, which is unchanged. Its
 * descriptor carries no `environmentId` — that belongs to each participant's
 * roster entry, not to the connector as a whole.
 */
export class RemoteEnvConnector implements Connector {
  readonly descriptor = connectorFor("remote-env");
  readonly acceptsDelivery = true;

  private readonly gateway: RemoteEnvironmentGateway;

  constructor(gateway: RemoteEnvironmentGateway) {
    this.gateway = gateway;
  }

  has(sessionId: string, participantId: string): boolean {
    return this.gateway.hasAgent(sessionId, participantId);
  }

  list(sessionId: string) {
    return this.gateway.listSubagents(sessionId);
  }

  deliver(request: DeliveryRequest): DeliveryResult {
    this.gateway.sendToAgent(
      request.sessionId,
      request.participantId,
      request.text,
      request.surfaceAuthor,
      request.delivery,
    );
    return { delivered: true };
  }

  spawn(sessionId: string, request: SubagentSpawnRequest): SpawnedSubagent {
    return this.gateway.spawnSubagent(sessionId, request);
  }

  kill(sessionId: string, participantId: string, completed: boolean): void {
    this.gateway.killAgent(sessionId, participantId, completed);
  }
}
