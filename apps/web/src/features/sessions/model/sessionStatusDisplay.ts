import type {
  AwaitingInput,
  SessionRunStatus,
} from "@tangent/shared/contracts";

/** The `StatusDot` variants a session run status can map to. */
export type SessionStatusVariant = "busy" | "active" | "disconnected";

/** Dot variant + human-readable label for a session's live run status. */
export interface SessionStatusDisplay {
  variant: SessionStatusVariant;
  label: string;
}

/** Maps a run status to its dot variant and label, shared by every view that
 * renders session status (the switcher list, sessions table, session header). */
export const SESSION_STATUS_DISPLAY: Record<
  SessionRunStatus,
  SessionStatusDisplay
> = {
  idle: { variant: "disconnected", label: "Idle" },
  active: { variant: "active", label: "Active" },
  busy: { variant: "busy", label: "Busy" },
};

/** "1 question" / "3 questions": how many of Prime's questions are unanswered. */
export function awaitingInputLabel({ count }: AwaitingInput): string {
  return `${count} ${count === 1 ? "question" : "questions"}`;
}

/**
 * When the oldest unanswered question was asked, as a clock time today or a
 * date before that. A fixed time stays right without re-rendering every minute.
 */
export function awaitingSinceLabel(
  { since }: AwaitingInput,
  now: Date = new Date(),
): string {
  const at = new Date(since);
  if (Number.isNaN(at.getTime())) return "";
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay
    ? at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
