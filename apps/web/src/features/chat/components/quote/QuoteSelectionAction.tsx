import { Button } from "@tangent/ui-primitives/button";
import { Icon } from "@tangent/ui-primitives/icon";
import { useEffect, useRef, useState } from "react";

import {
  type QuotedSelection,
  resolveQuotedSelection,
} from "@/features/chat/model/quoting";

import { FloatingQuoteSurface } from "./FloatingQuoteSurface";

const GAP = 8;
const ACTION_HEIGHT = 30;
const ACTION_WIDTH = 96;

interface PlacedQuote {
  messageId: string;
  text: string;
  top: number;
  left: number;
}

interface QuoteSelectionActionProps {
  scopeId: string;
  /** Receives the verbatim excerpt snapshotted when the selection was made. */
  onQuote: (excerpt: string) => void;
}

// Chrome exposes selections inside an open shadow tree on the ShadowRoot; other
// engines (and the standalone app) answer on the document.
function readSelection(root: Node, doc: Document): Selection | null {
  const scoped = root as { getSelection?: () => Selection | null };
  return scoped.getSelection?.() ?? doc.getSelection();
}

function dismissKey(quote: Pick<PlacedQuote, "messageId" | "text">): string {
  return `${quote.messageId}\u0000${quote.text}`;
}

// Sits just above the first selected line when there is room, otherwise below
// the whole selection, always clamped into the viewport.
function place(
  quote: QuotedSelection,
  view: Window,
): { top: number; left: number } {
  const { firstLine, rect } = quote;
  const left = Math.min(
    Math.max(firstLine.left, GAP),
    Math.max(view.innerWidth - ACTION_WIDTH - GAP, GAP),
  );
  const above = firstLine.top - GAP - ACTION_HEIGHT;
  const below = Math.min(
    rect.bottom + GAP,
    Math.max(view.innerHeight - ACTION_HEIGHT - GAP, GAP),
  );
  return { left, top: above >= GAP ? above : below };
}

function placed(quote: QuotedSelection, view: Window): PlacedQuote {
  return {
    messageId: quote.messageId,
    text: quote.text,
    ...place(quote, view),
  };
}

/**
 * Floating "Quote" action for a text selection inside a single message of this
 * conversation. It never takes focus on selection and never sends anything —
 * pressing it only hands the excerpt to the composer.
 */
export function QuoteSelectionAction({
  scopeId,
  onQuote,
}: QuoteSelectionActionProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [quote, setQuote] = useState<PlacedQuote | null>(null);
  const dismissedRef = useRef<string | null>(null);
  const clearSelectionRef = useRef<(() => void) | null>(null);
  const onQuoteRef = useRef(onQuote);

  useEffect(() => {
    onQuoteRef.current = onQuote;
  }, [onQuote]);

  useEffect(() => {
    const anchor = anchorRef.current;
    const doc = anchor?.ownerDocument;
    const view = doc?.defaultView;
    if (!anchor || !doc || !view) return;
    const root = anchor.getRootNode();

    clearSelectionRef.current = () =>
      readSelection(root, doc)?.removeAllRanges();

    const sync = () => {
      const next = resolveQuotedSelection(readSelection(root, doc), scopeId);
      if (!next) {
        dismissedRef.current = null;
        setQuote(null);
        return;
      }
      setQuote(
        dismissedRef.current === dismissKey(next) ? null : placed(next, view),
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const current = resolveQuotedSelection(
          readSelection(root, doc),
          scopeId,
        );
        if (current) dismissedRef.current = dismissKey(current);
        setQuote(null);
        return;
      }
      // Keyboard equivalent of pressing the floating action. Option+Q gives a
      // different `key` on macOS, so the physical key decides.
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code !== "KeyQ" && event.key.toLowerCase() !== "q") return;
      const current = resolveQuotedSelection(readSelection(root, doc), scopeId);
      if (!current) return;
      event.preventDefault();
      onQuoteRef.current(current.text);
      dismissedRef.current = dismissKey(current);
      setQuote(null);
      readSelection(root, doc)?.removeAllRanges();
    };

    doc.addEventListener("selectionchange", sync);
    doc.addEventListener("keydown", handleKeyDown);
    doc.addEventListener("scroll", sync, { capture: true, passive: true });
    // Scroll does not cross a shadow boundary, so an embedded message list
    // needs its own listener to keep the action anchored.
    if (root !== doc)
      root.addEventListener("scroll", sync, { capture: true, passive: true });
    view.addEventListener("resize", sync);
    sync();

    return () => {
      clearSelectionRef.current = null;
      doc.removeEventListener("selectionchange", sync);
      doc.removeEventListener("keydown", handleKeyDown);
      doc.removeEventListener("scroll", sync, { capture: true });
      if (root !== doc)
        root.removeEventListener("scroll", sync, { capture: true });
      view.removeEventListener("resize", sync);
    };
  }, [scopeId]);

  function handleQuote() {
    if (!quote) return;
    onQuote(quote.text);
    dismissedRef.current = dismissKey(quote);
    setQuote(null);
    clearSelectionRef.current?.();
  }

  return (
    <>
      <span ref={anchorRef} hidden />
      {quote ? (
        <FloatingQuoteSurface top={quote.top} left={quote.left}>
          <Button
            size="xs"
            variant="ghost"
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleQuote}
            aria-label="Quote selected text in the composer (Alt+Q)"
          >
            <Icon name="Quote" size="xs" />
            Quote
          </Button>
        </FloatingQuoteSurface>
      ) : null}
    </>
  );
}
