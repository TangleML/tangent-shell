import {
  type ConnectorKind,
  isTerminalStatus,
  type SpawnAuthority,
  type SubagentInfo,
} from "@tangent/shared/contracts.ts";

import type { A2aPeerGateway } from "../a2a/a2aPeerGateway.ts";
import type { ExternalSubagentGateway } from "../external/externalSubagentGateway.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { ConversationEventSink } from "../pi/types.ts";
import type { RemoteEnvironmentGateway } from "../remote/remoteEnvironmentGateway.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import { A2aConnector } from "./a2aConnector.ts";
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

  /**
   * Whether the connector for `kind` can carry a message at all. Read when
   * deriving a Membership: a transport nothing can be delivered to declares a
   * `never` reaction instead of silently swallowing wakes.
   */
  acceptsDelivery(kind: ConnectorKind): boolean {
    return this.forKind(kind)?.acceptsDelivery ?? false;
  }

  /** The connector that spawns `kind` on the server's behalf, if any may. */
  spawner(kind: ConnectorKind): SpawningConnector | undefined {
    const connector = this.forKind(kind);
    if (!connector || !canSpawn(connector)) return undefined;
    return connector;
  }

  /**
   * Restores a session's persisted sub-agents through whichever connector each
   * one belongs to. Resolution is by recorded kind rather than by {@link
   * ConnectorRegistry.resolve}, because nothing holds a participant yet — that
   * is the whole point of a revive.
   *
   * Terminal rows are skipped, so nothing resurrects a participant that finished
   * or was killed. Lifecycle is not consulted: what restoring means is the
   * connector's to decide, and both answers are real — re-spawning a process the
   * server owns, or restoring a `detached` tab for a far end that is still out
   * there. A connector with nothing to restore says so in its own `revive`.
   */
  revive(sessionId: string, persisted: SessionAgent[]): void {
    for (const agent of persisted) {
      if (agent.role !== "subagent") continue;
      if (isTerminalStatus(agent.status)) continue;
      this.forKind(agent.connector.kind)?.revive(sessionId, agent);
    }
  }

  /** The connector registered for a kind, if the server runs one. */
  private forKind(kind: ConnectorKind): Connector | undefined {
    return this.connectors.find((c) => c.descriptor.kind === kind);
  }
}

/** Builds the registry over the gateways the server runs today. */
export function createConnectorRegistry(
  pi: PiAgentManager,
  remoteGateway: RemoteEnvironmentGateway,
  externalGateway: ExternalSubagentGateway,
  a2aGateway: A2aPeerGateway,
  handlers: ConversationEventSink,
): ConnectorRegistry {
  return new ConnectorRegistry(
    [
      new PiConnector(pi),
      new RemoteEnvConnector(remoteGateway, handlers),
      new ExternalConnector(externalGateway, handlers),
      new A2aConnector(a2aGateway, handlers),
    ],
    new NullConnector(handlers),
  );
}
