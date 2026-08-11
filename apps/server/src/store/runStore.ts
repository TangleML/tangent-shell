import type {
  Run,
  RunId,
  RunIngress,
  RunStatus,
} from "@tangent/shared/contracts.ts";

/** The fields a caller supplies to persist a new {@link Run}. */
export interface CreateRunInput {
  id: RunId;
  sessionId: string;
  participantId: string;
  homeConversationId: string;
  ingress: RunIngress;
  externalId?: string;
  cursor?: string;
}

/**
 * The mutable fields of a {@link Run}. Omitted fields are left alone, matching
 * how {@link import("./sessionStore.ts").RecordAgentInput} treats a partial
 * write.
 */
export interface UpdateRunInput {
  status?: RunStatus;
  externalId?: string;
  cursor?: string;
  endedAt?: string;
}

/**
 * Durable home of the session's {@link Run}s. Kept apart from
 * {@link import("./sessionStore.ts").SessionStore} because a Run is not session
 * metadata: it is short-lived, written on the streaming hot path, and read by
 * the run registry rather than by the REST routes.
 */
export interface RunStore {
  createRun(input: CreateRunInput): Promise<Run>;
  updateRun(id: RunId, input: UpdateRunInput): Promise<void>;
  getRun(id: RunId): Promise<Run | undefined>;
  /** The session's runs, oldest first. */
  listRuns(sessionId: string): Promise<Run[]>;
  /**
   * Settles every row still marked `running` as `failed`. Nothing can be
   * running before the process starts, so a `running` row at boot is the
   * residue of a previous process that never got to settle it.
   */
  failStaleRuns(): Promise<number>;
}
