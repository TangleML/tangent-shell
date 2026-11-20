/** Marks the quotable body of one rendered message. */
export const QUOTE_MESSAGE_ATTR = "data-quote-message-id";

/** Ties a quotable message to the conversation panel instance that renders it. */
export const QUOTE_SCOPE_ATTR = "data-quote-scope";

export interface QuoteRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

interface QuoteElementLike {
  nodeType: number;
  parentElement: QuoteElementLike | null;
  getAttribute(name: string): string | null;
}

interface QuoteNodeLike {
  nodeType: number;
  parentElement: QuoteElementLike | null;
  getAttribute?: (name: string) => string | null;
}

/** `Range.compareBoundaryPoints` modes, by value so Node tests need no DOM. */
const START_TO_START = 0;
const END_TO_END = 2;

/** The subset of `Range` quoting needs; keeps the logic testable in Node. */
export interface QuoteRangeLike {
  startContainer: QuoteNodeLike;
  endContainer: QuoteNodeLike;
  startOffset: number;
  endOffset: number;
  cloneRange(): QuoteRangeLike;
  selectNodeContents(node: unknown): void;
  setStart(node: unknown, offset: number): void;
  setEnd(node: unknown, offset: number): void;
  compareBoundaryPoints(how: number, other: QuoteRangeLike): number;
  getBoundingClientRect(): QuoteRect;
  getClientRects(): ArrayLike<QuoteRect>;
  toString(): string;
}

/** The subset of `Selection` quoting needs; keeps the logic testable in Node. */
export interface QuoteSelectionLike {
  isCollapsed: boolean;
  rangeCount: number;
  getRangeAt(index: number): QuoteRangeLike;
}

/** A quoted excerpt waiting to be appended to a composer draft. */
export interface QuoteInsertion {
  id: string;
  text: string;
}

export interface QuotedSelection {
  messageId: string;
  /** Verbatim selected text, snapshotted before any toolbar interaction. */
  text: string;
  rect: QuoteRect;
  /** The first selected line, where the action is anchored. */
  firstLine: QuoteRect;
}

const ELEMENT_NODE = 1;

function asElement(node: QuoteNodeLike | null): QuoteElementLike | null {
  if (!node) return null;
  if (node.nodeType === ELEMENT_NODE && typeof node.getAttribute === "function")
    return node as QuoteElementLike;
  return node.parentElement;
}

/** The nearest enclosing quotable message element, or null outside one. */
function closestQuotable(node: QuoteNodeLike | null): QuoteElementLike | null {
  for (let el = asElement(node); el; el = el.parentElement) {
    if (el.getAttribute(QUOTE_MESSAGE_ATTR)) return el;
  }
  return null;
}

/**
 * A selection is quotable only when it is non-empty and both of its endpoints
 * sit inside the *same* message of *this* conversation panel. Selections that
 * span messages, land in the composer, or belong to another chat instance stay
 * plain native selections.
 */
export function resolveQuotedSelection(
  selection: QuoteSelectionLike | null,
  scopeId: string,
): QuotedSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return null;

  const range = selection.getRangeAt(0);
  const message = closestQuotable(range.startContainer);
  if (!message) return null;

  const messageId = message.getAttribute(QUOTE_MESSAGE_ATTR);
  if (!messageId) return null;
  if (message.getAttribute(QUOTE_SCOPE_ATTR) !== scopeId) return null;

  const quoted = clampToMessage(range, message);
  if (!quoted) return null;

  const text = quoted.toString();
  if (text.trim().length === 0) return null;

  const rect = quoted.getBoundingClientRect();
  return { messageId, text, rect, firstLine: firstLineOf(quoted) ?? rect };
}

// Element boundaries contribute zero-width rects, so skip to the first real
// line box.
function firstLineOf(range: QuoteRangeLike): QuoteRect | null {
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    if (rects[i].width > 0 && rects[i].height > 0) return rects[i];
  }
  return null;
}

/**
 * Keeps a selection that starts in this message but overshoots its end (a
 * triple-click or a drag past the last line usually lands in the next block)
 * quotable, as long as the overshoot is whitespace. Anything that really
 * reaches into another message is rejected.
 */
function clampToMessage(
  range: QuoteRangeLike,
  message: QuoteElementLike,
): QuoteRangeLike | null {
  if (closestQuotable(range.endContainer) === message) return range;

  const bounds = range.cloneRange();
  bounds.selectNodeContents(message);
  if (range.compareBoundaryPoints(START_TO_START, bounds) < 0) return null;
  if (range.compareBoundaryPoints(END_TO_END, bounds) <= 0) return null;

  const overflow = range.cloneRange();
  overflow.setStart(bounds.endContainer, bounds.endOffset);
  if (overflow.toString().trim().length > 0) return null;

  const clamped = range.cloneRange();
  clamped.setEnd(bounds.endContainer, bounds.endOffset);
  return clamped;
}

/** True when a pending insertion has not been applied to this composer yet. */
export function shouldApplyInsertion(
  insertion: QuoteInsertion | null | undefined,
  appliedId: string | null,
): insertion is QuoteInsertion {
  return !!insertion && insertion.id !== appliedId;
}

/**
 * Drops a pending insertion once a composer applied it, so remounting a
 * composer (switching session or agent) can never replay an old quote.
 */
export function clearInsertion(
  current: QuoteInsertion | null,
  appliedId: string,
): QuoteInsertion | null {
  return current?.id === appliedId ? null : current;
}

/**
 * Renders selected text as a Markdown blockquote: blank edge lines dropped,
 * interior blank lines and leading indentation (code excerpts) preserved.
 */
export function formatQuotedExcerpt(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""));

  while (lines.length > 0 && lines[0].length === 0) lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].length === 0) lines.pop();
  if (lines.length === 0) return "";

  return lines.map((line) => (line.length > 0 ? `> ${line}` : ">")).join("\n");
}

/**
 * Appends a quote below whatever the user already drafted, leaving a blank
 * line to type in. Returns the draft unchanged for an empty quote.
 */
export function appendQuoteToDraft(draft: string, quote: string): string {
  if (quote.length === 0) return draft;
  const base = draft.replace(/\s+$/, "");
  return base.length === 0 ? `${quote}\n\n` : `${base}\n\n${quote}\n\n`;
}
