/** The backend grant one trigger fires under, as the server keeps it. */
export interface TriggerDelegationRecord {
  sessionId: string;
  triggerId: string;
  participantId: string;
  delegationId: string;
  token: string;
}

/**
 * Holds trigger delegation tokens apart from the trigger definitions in the
 * session workspace, so a token never lands in a folder agents can read.
 * Synchronous because the trigger manager that writes it is.
 */
export interface TriggerDelegationStore {
  put(record: TriggerDelegationRecord): void;
  get(
    sessionId: string,
    triggerId: string,
  ): TriggerDelegationRecord | undefined;
  delete(sessionId: string, triggerId: string): void;
}
