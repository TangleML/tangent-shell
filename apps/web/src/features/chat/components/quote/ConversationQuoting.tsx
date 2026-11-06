import { type ReactNode, useCallback, useId, useState } from "react";

import {
  clearInsertion,
  formatQuotedExcerpt,
  type QuoteInsertion,
} from "@/features/chat/model/quoting";

import { QuoteScopeContext } from "./quoteScope";
import { QuoteSelectionAction } from "./QuoteSelectionAction";

interface ConversationQuotingProps {
  children: ReactNode;
}

/**
 * Enables "quote a selection into this conversation's composer" for everything
 * it wraps: messages rendered inside become quotable, and the composer inside
 * receives the quoted excerpt as draft text. Each instance has its own scope,
 * so several chats on one page never quote into each other.
 */
export function ConversationQuoting({ children }: ConversationQuotingProps) {
  const scopeId = useId();
  const [insertion, setInsertion] = useState<QuoteInsertion | null>(null);
  const [composerReady, setComposerReady] = useState(false);

  // A quote is consumed by the composer that is mounted right now; it must
  // never be replayed into a composer that mounts later (another session).
  const consumeInsertion = useCallback((id: string) => {
    setInsertion((current) => clearInsertion(current, id));
  }, []);

  function quote(excerpt: string) {
    const text = formatQuotedExcerpt(excerpt);
    if (text.length === 0) return;
    setInsertion({ id: crypto.randomUUID(), text });
  }

  return (
    <QuoteScopeContext
      value={{ scopeId, insertion, consumeInsertion, setComposerReady }}
    >
      {children}
      {composerReady ? (
        <QuoteSelectionAction scopeId={scopeId} onQuote={quote} />
      ) : null}
    </QuoteScopeContext>
  );
}
