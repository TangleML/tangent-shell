import type {
  TriggerDelegationRecord,
  TriggerDelegationStore,
} from "./triggerDelegationStore.ts";

/** Process-local {@link TriggerDelegationStore}, for tests and DB-less wiring. */
export class InMemoryTriggerDelegationStore implements TriggerDelegationStore {
  private readonly records = new Map<string, TriggerDelegationRecord>();

  put(record: TriggerDelegationRecord): void {
    this.records.set(keyFor(record.sessionId, record.triggerId), record);
  }

  get(
    sessionId: string,
    triggerId: string,
  ): TriggerDelegationRecord | undefined {
    return this.records.get(keyFor(sessionId, triggerId));
  }

  delete(sessionId: string, triggerId: string): void {
    this.records.delete(keyFor(sessionId, triggerId));
  }
}

function keyFor(sessionId: string, triggerId: string): string {
  return `${sessionId}\u0000${triggerId}`;
}
