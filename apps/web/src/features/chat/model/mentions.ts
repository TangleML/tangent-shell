import type {
  ParticipantWithMemberships,
  SubagentInfo,
} from "@tangent/shared/contracts";
import { PI_AGENT } from "@tangent/shared/contracts";

/** Someone a composer can address with `@`. Ids stay stable; names are shown. */
export interface MentionCandidate {
  id: string;
  name: string;
}

/**
 * The characters that open a composer picker: `@` to address, `#` to
 * reference, `/` to run a command.
 */
export type ComposerTrigger = "@" | "#" | "/";

/** An in-progress `@mention` or `#reference` the caret is sitting in. */
export interface ActiveMention {
  trigger: ComposerTrigger;
  /** Index of the trigger that opened it. */
  start: number;
  /** Text typed after the trigger, up to the caret. */
  query: string;
}

/**
 * The people and agents a composer can address: Prime, the live sub-agent
 * roster, and every invited (non-revoked) human. The server re-resolves `@name`
 * to ids at write time; this list only drives the picker, so a name shown here
 * matching the server's roster is enough.
 */
export function buildMentionCandidates(
  subagents: SubagentInfo[],
  participants: ParticipantWithMemberships[],
): MentionCandidate[] {
  const humans = participants
    .filter((p) => p.kind === "human" && !p.revokedAt)
    .map((p) => ({ id: p.id, name: p.displayName }));
  return [
    { id: PI_AGENT.id, name: PI_AGENT.name },
    ...subagents.map((s) => ({ id: s.id, name: s.name })),
    ...humans,
  ];
}

/** Matches the server's mention normalization (drop case, spaces, `_`, `-`). */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, "");
}

/**
 * The mention the caret is currently inside, or null. A mention opens at a
 * trigger that starts the text or follows whitespace, and runs until the caret
 * with no whitespace or second trigger in between — for `@`, the same grammar
 * the server resolves. A command's `/` only counts at the start of the text.
 */
export function findActiveMention(
  value: string,
  caret: number,
  trigger: ComposerTrigger = "@",
): ActiveMention | null {
  // `lastIndexOf` reads a start of -1 as 0, which finds a trigger after the caret.
  if (caret <= 0) return null;
  const at = value.lastIndexOf(trigger, caret - 1);
  if (at < 0) return null;
  if (trigger === "/" && value.slice(0, at).trim() !== "") return null;
  if (at > 0 && !/\s/.test(value[at - 1])) return null;
  const query = value.slice(at + 1, caret);
  if (/\s/.test(query) || query.includes(trigger)) return null;
  return { trigger, start: at, query };
}

/** Candidates whose name or id contains the query, in roster order. */
export function filterMentionCandidates(
  candidates: MentionCandidate[],
  query: string,
  limit = 8,
): MentionCandidate[] {
  const q = normalize(query);
  const matches = candidates.filter(
    (c) => normalize(c.name).includes(q) || normalize(c.id).includes(q),
  );
  return matches.slice(0, limit);
}

/**
 * The name is inserted without its spaces so the server's `@([^\s]+)` grammar
 * captures the whole token; normalization makes it resolve back to the
 * candidate's id.
 */
export function mentionToken(candidate: MentionCandidate): string {
  return `@${candidate.name.replace(/\s+/g, "")}`;
}

/** Replaces the active mention's trigger and query with `token`. */
export function applyToken(
  value: string,
  caret: number,
  active: ActiveMention,
  token: string,
): { value: string; caret: number } {
  const inserted = `${token} `;
  const next = value.slice(0, active.start) + inserted + value.slice(caret);
  return { value: next, caret: active.start + inserted.length };
}
