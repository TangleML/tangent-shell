import { connectorFor } from "@tangent/shared/contracts.ts";

import type { SubagentSpawnRequest } from "../pi/agentConfig.ts";
import type { SpawnedSubagent } from "../pi/piAgentManager.ts";
import type { PiAgentHandlers } from "../pi/types.ts";
import type { RemoteEnvironmentGateway } from "../remote/remoteEnvironmentGateway.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import { refuseDelivery } from "./refusal.ts";
import type {
  CancelResult,
  Connector,
  DeliveryRequest,
  DeliveryResult,
} from "./types.ts";

/**
 * Why a cancellation is refused: the remote protocol carries commands to spawn,
 * message and kill an agent, but nothing to interrupt a turn in progress.
 */
const NO_CANCEL_PROTOCOL =
  "Remote sub-agents can't be interrupted mid-turn; kill it instead.";

/** Shown in the sub-agent's own thread when its environment isn't connected. */
const ENVIRONMENT_DETACHED =
  "This sub-agent's environment is disconnected, so the message wasn't delivered.";

/**
 * The connector for sub-agents hosted inside a connected remote environment. A
 * thin adapter over {@link RemoteEnvironmentGateway}. Its descriptor carries no
 * `environmentId` — that belongs to each participant's roster entry, not to the
 * connector as a whole.
 */
export class RemoteEnvConnector implements Connector {
  readonly descriptor = connectorFor("remote-env");
  readonly acceptsDelivery = true;

  private readonly gateway: RemoteEnvironmentGateway;
  private readonly handlers: PiAgentHandlers;

  constructor(gateway: RemoteEnvironmentGateway, handlers: PiAgentHandlers) {
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
    const delivered = this.gateway.sendToAgent(
      request.sessionId,
      request.participantId,
      request.text,
      request.surfaceAuthor,
      request.delivery,
      request.ingress,
    );
    if (delivered) return { delivered: true };
    // A detached participant stays in the roster, so this connector still holds
    // it and has to say why the message went nowhere.
    return refuseDelivery(this.handlers, request, ENVIRONMENT_DETACHED);
  }

  cancelRun(): CancelResult {
    return { cancelled: false, reason: NO_CANCEL_PROTOCOL };
  }

  spawn(sessionId: string, request: SubagentSpawnRequest): SpawnedSubagent {
    return this.gateway.spawnSubagent(sessionId, request);
  }

  kill(sessionId: string, participantId: string, completed: boolean): void {
    this.gateway.killAgent(sessionId, participantId, completed);
  }

  revive(sessionId: string, agent: SessionAgent): void {
    // The environment owns the process, and the protocol has no way to ask it
    // what it still runs. So the tab comes back `detached` and the far end
    // reattaches by declaring the participant active again.
    this.gateway.reattach(sessionId, agent);
  }
}
