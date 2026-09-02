/**
 * Why the fan-out engine stopped instead of waking someone. A bound that cuts a
 * cascade without saying so converts a runaway loop into a stall, which is
 * harder to diagnose and no less broken — so every cause is surfaced as a
 * system Message in the Conversation it happened in.
 *
 * A delivery a connector refuses is not here: the connector already says so in
 * the addressed conversation through `refuseDelivery`.
 */
export type TerminationCause =
  | { kind: "wave-depth-exhausted"; participantId: string; limit: number }
  | { kind: "reaction-budget-exhausted"; limit: number }
  | { kind: "wake-refused"; participantId: string }
  | { kind: "correlation-timeout"; askedBy: string; askedOf?: string };

/** The text a cause is surfaced as. */
export function describeCause(cause: TerminationCause): string {
  if (cause.kind === "wake-refused") {
    return "This agent doesn't react to messages here, so nothing was delivered.";
  }
  if (cause.kind === "wave-depth-exhausted") {
    return (
      `Stopped here: this chain of reactions reached its limit of ${cause.limit} ` +
      `hops, so nothing further was woken.`
    );
  }
  if (cause.kind === "correlation-timeout") {
    const target = cause.askedOf ? ` to ${cause.askedOf}` : "";
    return `No answer arrived in time for ${cause.askedBy}'s question${target}.`;
  }
  return (
    `Stopped here: this conversation reached its limit of ${cause.limit} ` +
    `reactions for one chain, so nothing further was woken.`
  );
}
