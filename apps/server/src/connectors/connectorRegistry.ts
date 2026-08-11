import type {
  ConnectorKind,
  SpawnAuthority,
  SubagentInfo,
} from "@tangent/shared/contracts.ts";

import type { ExternalSubagentGateway } from "../external/externalSubagentGateway.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { PiAgentHandlers } from "../pi/types.ts";
import type { RemoteEnvironmentGateway } from "../remote/remoteEnvironmentGateway.ts";
import { ExternalConnector } from "./externalConnector.ts";
import { NullConnector } from "./nullConnector.ts";
import { PiConnector } from "./piConnector.ts";
import { RemoteEnvConnector } from "./remoteEnvConnector.ts";
import type { CancelResult, Connector, RunCancellation } from "./types.ts";

/**
 * The spawn authorities the server may act on for a caller. `bundle-tool` and
 * `none` participants exist only because something else created them, so the
 * spawn API refuses them however the request is phrased.
 */
const API_SPAWN_AUTHORITIES: SpawnAuthority[] = ["server", "remote-env"];

/** A connector that can create participants, narrowed so `spawn` is callable. */
export type SpawningConnector = Connector & {
  spawn: NonNullable<Connector["spawn"]>;
};

/** Whether the spawn API may create participants on this connector. */
function canSpawn(connector: Connector): connector is SpawningConnector {
  if (!connector.spawn) return false;
  return API_SPAWN_AUTHORITIES.includes(connector.descriptor.spawnAuthority);
}

/**
 * The set of connectors a session's participants can live on, and the single
 * lookup that maps a participant to one of them.
 *
 * {@link ConnectorRegistry.resolve} is **total**: every participant id resolves
 * to a connector, an unknown one to a {@link NullConnector} that refuses in the
 * addressed conversation. Callers therefore never re-derive routing, and there
 * is no fall-through branch for a participant to be mis-delivered down.
 */
export class ConnectorRegistry {
  private readonly connectors: Connector[];
  private readonly fallback: Connector;

  constructor(connectors: Connector[], fallback: Connector) {
    this.connectors = connectors;
    this.fallback = fallback;
  }

  /** The connector holding `participantId`, or the refusing fallback. */
  resolve(sessionId: string, participantId: string): Connector {
    const held = this.connectors.find((connector) =>
      connector.has(sessionId, participantId),
    );
    return held ?? this.fallback;
  }

  /** Every connector's roster for the session, in registration order. */
  list(sessionId: string): SubagentInfo[] {
    return this.connectors.flatMap((connector) => connector.list(sessionId));
  }

  /**
   * Stops a participant's in-progress Run through whichever connector holds it.
   * Cancellation is a connector capability, not something a caller decides by
   * inspecting the transport.
   */
  cancelRun(request: RunCancellation): CancelResult {
    return this.resolve(request.sessionId, request.participantId).cancelRun(
      request,
    );
  }

  /** The connector that spawns `kind` on the server's behalf, if any may. */
  spawner(kind: ConnectorKind): SpawningConnector | undefined {
    const connector = this.connectors.find((c) => c.descriptor.kind === kind);
    if (!connector || !canSpawn(connector)) return undefined;
    return connector;
  }
}

/** Builds the registry over the gateways the server runs today. */
export function createConnectorRegistry(
  pi: PiAgentManager,
  remoteGateway: RemoteEnvironmentGateway,
  externalGateway: ExternalSubagentGateway,
  handlers: PiAgentHandlers,
): ConnectorRegistry {
  return new ConnectorRegistry(
    [
      new PiConnector(pi),
      new RemoteEnvConnector(remoteGateway),
      new ExternalConnector(externalGateway, handlers),
    ],
    new NullConnector(handlers),
  );
}
