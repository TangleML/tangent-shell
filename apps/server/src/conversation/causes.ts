import type {
  AdmissionPolicy,
  TerminationCause,
} from "@tangent/shared/contracts.ts";

export type { TerminationCause };

/** Why a wake was refused mid-Run: a `preempt` nothing could cancel, or any
 * other policy that declined concurrent work. */
function describeAdmissionRejected(policy: AdmissionPolicy): string {
  if (policy === "preempt") {
    return "This agent couldn't be interrupted to take a new message, so nothing was delivered.";
  }
  return "This agent is already working and doesn't take concurrent messages, so nothing was delivered.";
}

/** Why a bound stopped a cascade: the per-chain hop limit or one Conversation's
 * per-wave reaction budget. */
function describeBudget(
  budget: "wave-depth" | "conversation-reactions",
  limit: number,
): string {
  if (budget === "wave-depth") {
    return (
      `Stopped here: this chain of reactions reached its limit of ${limit} ` +
      `hops, so nothing further was woken.`
    );
  }
  return (
    `Stopped here: this conversation reached its limit of ${limit} ` +
    `reactions for one chain, so nothing further was woken.`
  );
}

/** Why a request expired unanswered, naming who asked and (when known) of whom. */
function describeCorrelationTimeout(askedBy: string, askedOf?: string): string {
  const target = askedOf ? ` to ${askedOf}` : "";
  return `No answer arrived in time for ${askedBy}'s question${target}.`;
}

/** The kinds whose text needs no attribution — a fixed sentence apiece. */
const PLAIN_CAUSE_TEXT: Record<string, string> = {
  "wake-refused":
    "This agent doesn't react to messages here, so nothing was delivered.",
  "run-error":
    "This agent's run ended with an error, so its work stopped without finishing.",
  "connector-detached":
    "This agent's connection dropped, so its work stopped without finishing.",
};

/**
 * The text a cause is surfaced as. A bound that cuts a cascade without saying so
 * converts a runaway loop into a stall, harder to diagnose and no less broken —
 * so every cause is surfaced as a system Message in the Conversation it happened
 * in, carrying its structured self for a supervisor to react to.
 */
export function describeCause(cause: TerminationCause): string {
  if (cause.kind === "admission-rejected") {
    return describeAdmissionRejected(cause.policy);
  }
  if (cause.kind === "budget-exhausted") {
    return describeBudget(cause.budget, cause.limit);
  }
  if (cause.kind === "correlation-timeout") {
    return describeCorrelationTimeout(cause.askedBy, cause.askedOf);
  }
  return PLAIN_CAUSE_TEXT[cause.kind];
}
