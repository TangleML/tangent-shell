import type { MemoryBackend, MemoryToolSpec } from "./types.ts";

/**
 * A preamble-only backend telling agents that memory the session is bound to
 * was left out of this spawn — typically a shared folder unmounted or deleted
 * after creation — so they don't read its absence as an empty memory or keep
 * editing it through a leftover workspace link.
 */
export class DroppedMemoryNotice implements MemoryBackend {
  readonly kind = "dropped-notice";
  private readonly labels: readonly string[];

  /** @param labels the dropped leaves' roots, as the binding names them */
  constructor(labels: readonly string[]) {
    this.labels = labels;
  }

  init(): void {
    // Nothing to prepare: the notice only contributes a preamble.
  }

  preamble(): string {
    return [
      "## Project memory unavailable",
      "",
      "This session is bound to memory that couldn't be loaded, so it is not",
      "in your context and its memory tools are off:",
      "",
      ...this.labels.map((label) => `- \`${label}\``),
      "",
      "Its shared folder may have been unmounted or deleted. Don't treat the",
      "missing memory as empty or write to it through leftover workspace",
      "paths; tell the user if it matters for the task.",
    ].join("\n");
  }

  tools(): MemoryToolSpec[] {
    return [];
  }

  execute(): undefined {
    return undefined;
  }
}
