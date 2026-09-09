import type { Run, RunId } from "@tangent/shared/contracts.ts";

import type { CreateRunInput, RunStore, UpdateRunInput } from "./runStore.ts";

/**
 * Process-local {@link RunStore}, mirroring
 * {@link import("./inMemorySessionStore.ts").InMemorySessionStore}. Runs vanish
 * with the process, so this is for tests and for wiring a run registry that has
 * no DB to write to.
 */
export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<RunId, Run>();

  async createRun(input: CreateRunInput): Promise<Run> {
    const now = new Date().toISOString();
    const run: Run = {
      ...input,
      status: "running",
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(run.id, run);
    return run;
  }

  async updateRun(id: RunId, input: UpdateRunInput): Promise<void> {
    const run = this.runs.get(id);
    if (!run) return;
    // Absent fields leave the stored value alone, matching the SQLite store.
    this.runs.set(id, {
      ...run,
      status: input.status ?? run.status,
      externalId: input.externalId ?? run.externalId,
      cursor: input.cursor ?? run.cursor,
      endedAt: input.endedAt ?? run.endedAt,
      updatedAt: new Date().toISOString(),
    });
  }

  async getRun(id: RunId): Promise<Run | undefined> {
    return this.runs.get(id);
  }

  async listRuns(sessionId: string): Promise<Run[]> {
    return [...this.runs.values()]
      .filter((run) => run.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async failStaleRuns(): Promise<number> {
    const now = new Date().toISOString();
    let failed = 0;
    for (const [id, run] of this.runs) {
      if (run.status !== "running") continue;
      this.runs.set(id, {
        ...run,
        status: "failed",
        endedAt: now,
        updatedAt: now,
      });
      failed += 1;
    }
    return failed;
  }
}
