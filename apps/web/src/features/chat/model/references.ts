import type { PinnedArtifact } from "@tangent/shared/contracts";
import type { IconName } from "@tangent/ui-primitives/icon";

import { matchRank, normalize } from "./matching";

export type ChatReferenceKind = "pipeline" | "document" | "run" | "file";

/**
 * Something a message can point at with `#`. It is sent as a markdown link to
 * `href`, so the agent gets an address it can act on (a host `type://identity`
 * target, or a workspace path) and the transcript can show it as a chip.
 */
export interface ChatReference {
  kind: ChatReferenceKind;
  label: string;
  href: string;
  detail?: string;
}

/** References picked into a draft, by the token each was inserted as. */
export type PickedReferences = ReadonlyMap<string, ChatReference>;

export const REFERENCE_GROUPS: readonly {
  kind: ChatReferenceKind;
  title: string;
  icon: IconName;
}[] = [
  { kind: "pipeline", title: "Pipelines", icon: "Workflow" },
  { kind: "document", title: "Documents", icon: "FileText" },
  { kind: "run", title: "Runs", icon: "Play" },
  { kind: "file", title: "Files", icon: "Paperclip" },
];

export interface ReferenceGroup {
  kind: ChatReferenceKind;
  title: string;
  icon: IconName;
  references: ChatReference[];
  total: number;
}

const BROWSE_LIMIT = 3;
const SEARCH_LIMIT = 6;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;
const TOKEN = /(^|\s)#([^\s#@]+)/g;
const LINK = /\[((?:\\.|[^\]\\])*)\]\((<[^>\n]*>|[^\s)]+)\)/g;

/**
 * The session's pinned artifacts, most recently pinned first, addressed by
 * their workspace path. Every pin lives under `artifacts/`, so the detail
 * leaves that out.
 */
export function artifactReferences(
  artifacts: PinnedArtifact[],
): ChatReference[] {
  return [...artifacts]
    .sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt))
    .map((artifact) => ({
      kind: "file",
      label: artifact.title,
      href: artifact.path,
      detail: artifact.path.replace(/^(\.\/)?artifacts\//, ""),
    }));
}

/**
 * The references the query matches, by kind. Each kind keeps the order it was
 * given (most recent first) behind the closest name matches, and shows only a
 * few: three while browsing, six once something is typed. `total` says how
 * many more there are to narrow down to.
 */
export function groupReferences(
  references: ChatReference[],
  query: string,
): ReferenceGroup[] {
  const q = query.trim().toLowerCase();
  const matches = references.filter(
    (reference) =>
      normalize(reference.label).includes(normalize(q)) ||
      normalize(reference.detail ?? "").includes(normalize(q)),
  );
  const ranked = q
    ? matches
        .map((reference, order) => ({
          reference,
          order,
          score: matchRank(reference.label, q),
        }))
        .sort((a, b) => a.score - b.score || a.order - b.order)
        .map(({ reference }) => reference)
    : matches;
  const limit = q ? SEARCH_LIMIT : BROWSE_LIMIT;

  return REFERENCE_GROUPS.flatMap((group) => {
    const ofKind = ranked.filter((reference) => reference.kind === group.kind);
    if (ofKind.length === 0) return [];
    return [
      { ...group, references: ofKind.slice(0, limit), total: ofKind.length },
    ];
  });
}

// Brackets and trailing punctuation are dropped so the token survives being
// typed mid-sentence, as in "(see #Churn-model)." or a markdown link.
function slug(label: string): string {
  const token = label
    .replace(/[[\]()<>]/g, "")
    .trim()
    .replace(/[\s#@]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(TRAILING_PUNCTUATION, "")
    .replace(/^-+|-+$/g, "");
  return token || "reference";
}

/**
 * The readable `#token` a reference is inserted as. Two different references
 * with one label in the same draft get `-2`, `-3`, ... so each token still
 * expands to the reference that was picked.
 */
export function referenceToken(
  reference: ChatReference,
  picked: PickedReferences,
): string {
  const base = `#${slug(reference.label)}`;
  for (let n = 1; ; n++) {
    const token = n === 1 ? base : `${base}-${n}`;
    const taken = picked.get(token);
    if (!taken || taken.href === reference.href) return token;
  }
}

function escapeLabel(label: string): string {
  return label.replace(/[\\[\]]/g, "\\$&");
}

function referenceLink(reference: ChatReference): string {
  const href = /[\s()<>]/.test(reference.href)
    ? `<${reference.href}>`
    : reference.href;
  return `[${escapeLabel(reference.label)}](${href})`;
}

/**
 * Turns each `#token` in a message into its reference's markdown link. A token
 * picked into this draft resolves to that pick; one typed by hand, or kept in a
 * draft across a reload, resolves when exactly one reference has that label.
 * Anything else is left as typed.
 */
export function expandReferences(
  text: string,
  picked: PickedReferences,
  references: ChatReference[],
): string {
  function resolve(token: string): ChatReference | undefined {
    const pick = picked.get(token);
    if (pick) return pick;
    const key = token.toLowerCase();
    const named = references.filter(
      (reference) => `#${slug(reference.label)}`.toLowerCase() === key,
    );
    return named.length === 1 ? named[0] : undefined;
  }

  return text.replace(TOKEN, (match, lead: string, body: string) => {
    const trailing = body.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    const reference = resolve(
      `#${body.slice(0, body.length - trailing.length)}`,
    );
    return reference ? `${lead}${referenceLink(reference)}${trailing}` : match;
  });
}

export type MessageTextSegment =
  | { kind: "text"; text: string }
  | { kind: "reference"; label: string; href: string; offset: number };

/**
 * Splits a person's message into plain text and the reference links in it.
 * Only links `isReference` accepts become references; any other markdown stays
 * exactly as it was typed.
 */
export function splitReferenceLinks(
  text: string,
  isReference: (href: string) => boolean,
): MessageTextSegment[] {
  const segments: MessageTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LINK)) {
    const [whole, rawLabel, rawHref] = match;
    const href = rawHref.startsWith("<") ? rawHref.slice(1, -1) : rawHref;
    if (!isReference(href)) continue;

    const offset = match.index;
    if (offset > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, offset) });
    }
    segments.push({
      kind: "reference",
      label: rawLabel.replace(/\\(.)/g, "$1"),
      href,
      offset,
    });
    cursor = offset + whole.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}
