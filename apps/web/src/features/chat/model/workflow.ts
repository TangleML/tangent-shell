import type {
  ParticipantWithMemberships,
  ReactorName,
  Resource,
  TerminationCause,
  WorkflowReactor,
} from "@tangent/shared/contracts";

/** Human label for each Reactor preset. */
const REACTOR_LABEL: Record<ReactorName, string> = {
  awaitAll: "Await all",
  awaitQuorum: "Await quorum",
  firstOf: "First of",
  awaitDeadline: "Await deadline",
  debounce: "Debounce",
  supervise: "Supervise",
};

/** Human label for each structured termination cause. */
const CAUSE_LABEL: Record<TerminationCause["kind"], string> = {
  "budget-exhausted": "Budget exhausted",
  "run-error": "Run failed",
  "connector-detached": "Connector detached",
  "admission-rejected": "Admission rejected",
  "correlation-timeout": "Correlation timed out",
  "wake-refused": "Wake refused",
};

export function reactorLabel(reactor: WorkflowReactor): string {
  return REACTOR_LABEL[reactor.spec.name];
}

export function causeLabel(cause: TerminationCause): string {
  return CAUSE_LABEL[cause.kind];
}

/** Resolves participant ids to their roster display name, falling back to the id. */
export function displayNameFor(
  participants: ParticipantWithMemberships[],
): (id: string) => string {
  const names = new Map(participants.map((p) => [p.id, p.displayName]));
  return (id: string) => names.get(id) ?? id;
}

/**
 * A short, human sentence for what a Reactor is still waiting on, folded from
 * its state without executing anything — the "2 of 3" the workflow view exists
 * to surface. Ready reactors read as done.
 */
export function reactorWaiting(
  reactor: WorkflowReactor,
  nameFor: (id: string) => string,
): string {
  const { spec, state } = reactor;

  if (spec.name === "awaitAll" && state.kind === "await") {
    const target = [...(spec.participants ?? []), ...(spec.runs ?? [])];
    if (reactor.ready) return `All ${target.length} complete`;
    return `Waiting on ${state.seen.length} of ${target.length}`;
  }

  if (spec.name === "awaitQuorum" && state.kind === "await") {
    if (reactor.ready) return `Reached quorum of ${spec.n}`;
    return `Waiting for ${state.seen.length} of ${spec.n} (of ${spec.of.length})`;
  }

  if (spec.name === "firstOf" && state.kind === "first") {
    const set = [...(spec.participants ?? []), ...(spec.runs ?? [])].map(
      nameFor,
    );
    if (state.fired) return "First completion observed";
    return `Waiting for the first of ${set.join(", ")}`;
  }

  if (spec.name === "awaitDeadline" && state.kind === "deadline") {
    if (state.due) return "Deadline passed";
    return `Waiting until ${formatInstant(spec.at)}`;
  }

  if (spec.name === "debounce" && state.kind === "debounce") {
    if (state.due) return "Quiet window elapsed";
    return `Waiting for a ${spec.windowMs}ms quiet window`;
  }

  if (spec.name === "supervise" && state.kind === "cause") {
    if (state.fired) return "A failure was observed";
    return "Watching for failures";
  }

  return reactor.ready ? "Ready" : "Waiting";
}

/** A digest resource's covered seq range, from its `meta`, when present. */
export function digestRange(resource: Resource): string | null {
  const from = resource.meta?.fromSeq;
  const to = resource.meta?.toSeq;
  if (typeof from === "number" && typeof to === "number") {
    return `seq ${from}\u2013${to}`;
  }
  return null;
}

/** Formats an ISO instant as a locale time, falling back to the raw string. */
export function formatInstant(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}
