import {
  type EgressResponse,
  resolveEgress,
} from "../../bundleUi/egressAllowlist.ts";
import { EGRESS_DELEGATION_PATH } from "../../config.ts";

/** The grant a trigger acts under, as the backend issued it. */
export interface TriggerDelegation {
  participantId: string;
  delegationId: string;
  delegationToken: string;
}

/** The egress call this client makes; the resolver, unless a test substitutes one. */
export type DelegationEgress = (
  input: Parameters<typeof resolveEgress>[0],
  init: Parameters<typeof resolveEgress>[1],
  caller: "server",
  options: { identityToken?: string },
) => Promise<EgressResponse>;

function issued(
  response: EgressResponse,
): { id: string; token: string } | undefined {
  if (!response.ok) return undefined;
  const body = response.json as { id?: unknown; token?: unknown } | undefined;
  if (typeof body?.id !== "string" || typeof body.token !== "string") {
    return undefined;
  }
  return { id: body.id, token: body.token };
}

/**
 * Mints and revokes the backend delegations a trigger fires under, so a
 * schedule that outlives its creator's assertion still acts as that person.
 * Off when no delegation path is configured.
 */
export class TriggerDelegations {
  private readonly egress: DelegationEgress;
  private readonly path: string;

  constructor(
    egress: DelegationEgress = resolveEgress,
    path: string = EGRESS_DELEGATION_PATH,
  ) {
    this.egress = egress;
    this.path = path;
  }

  get enabled(): boolean {
    return this.path.length > 0;
  }

  /**
   * Asks the backend for a delegation scoped to one trigger, presenting the
   * participant's assertion. A refusal or failure is logged and yields nothing:
   * the trigger is still created, just without a delegation.
   */
  async register(
    triggerId: string,
    participantId: string,
    assertion: string,
  ): Promise<TriggerDelegation | undefined> {
    if (!this.enabled) return undefined;
    try {
      const response = await this.egress(
        { target: "tangle", path: this.path },
        { method: "POST", body: { scope: `trigger:${triggerId}` } },
        "server",
        { identityToken: assertion },
      );
      const grant = issued(response);
      if (!grant) {
        console.warn(
          `[triggers] delegation for ${triggerId} refused (HTTP ${response.status})`,
        );
        return undefined;
      }
      return {
        participantId,
        delegationId: grant.id,
        delegationToken: grant.token,
      };
    } catch (err) {
      console.warn(`[triggers] delegation for ${triggerId} failed:`, err);
      return undefined;
    }
  }

  /** Revokes a trigger's delegation, best effort. */
  async revoke(delegationId: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.egress(
        { target: "tangle", path: `${this.path}/${delegationId}` },
        { method: "DELETE" },
        "server",
        {},
      );
    } catch (err) {
      console.warn(
        `[triggers] revoking delegation ${delegationId} failed:`,
        err,
      );
    }
  }
}
