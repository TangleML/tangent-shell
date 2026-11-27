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

/** The longest {@link describeRunFailure} reason, so one huge error can't flood
 * a notice or the supervisor's wake. */
export const MAX_RUN_FAILURE_REASON = 500;

/** Credentials an error message can carry (a request echoed back, a URL with
 * userinfo), each replaced with its non-secret prefix kept. */
const CREDENTIAL_PATTERNS: [RegExp, string][] = [
  // `scheme://user:password@host`
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@"],
  // `Authorization: Bearer <token>`, `Basic <credentials>`
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]"],
  // `api_key=…`, `"token": "…"`, `x-api-key: …`
  [
    /\b((?:x-)?api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|token|secret|password|passwd)(["']?\s*[:=]\s*["']?)(?!\[redacted\])[^\s"'&,;}]+/gi,
    "$1$2[redacted]",
  ],
  // `?key=…`, `&sig=…` in a URL's query
  [/([?&](?:key|sig|signature)=)[^&\s"']+/gi, "$1[redacted]"],
  // Well-known token shapes: `sk-…` keys, GitHub tokens, JWTs, Google API keys.
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "[redacted]"],
  [
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
    "[redacted]",
  ],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[redacted]"],
];

/** `name: message`, or whichever of the two is there. */
function namedText(name: unknown, message: unknown): string {
  const text = typeof message === "string" ? message : "";
  if (typeof name !== "string" || !name) return text;
  return text ? `${name}: ${text}` : name;
}

/** An error's class and message, or the text a failure was reported as. */
function failureText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error === undefined || error === null) return "";
  if (typeof error === "object") {
    const { name, message } = error as { name?: unknown; message?: unknown };
    return namedText(name, message);
  }
  return String(error);
}

/**
 * The reason a failed Run's cause carries: the settlement error's class and
 * message on one line, credentials redacted, cut to
 * {@link MAX_RUN_FAILURE_REASON} characters. Redacted before it is cut, so a
 * token straddling the limit can't leak its head. `undefined` when there is
 * nothing to say.
 */
export function describeRunFailure(error: unknown): string | undefined {
  let text = failureText(error).replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of CREDENTIAL_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  if (!text) return undefined;
  if (text.length <= MAX_RUN_FAILURE_REASON) return text;
  return `${text.slice(0, MAX_RUN_FAILURE_REASON - 1).trimEnd()}…`;
}

/** A failed Run's notice, with the reason when the settlement carried one. */
function describeRunError(reason?: string): string {
  const base =
    "This agent's run ended with an error, so its work stopped without finishing.";
  return reason ? `${base} Reason: ${reason}` : base;
}

/** The kinds whose text needs no attribution — a fixed sentence apiece. */
const PLAIN_CAUSE_TEXT: Record<string, string> = {
  "wake-refused":
    "This agent doesn't react to messages here, so nothing was delivered.",
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
  if (cause.kind === "run-error") return describeRunError(cause.reason);
  return PLAIN_CAUSE_TEXT[cause.kind];
}
