import { createContext, useContext } from "react";

import type { QuoteInsertion } from "@/features/chat/model/quoting";

export interface QuoteScopeValue {
  /** Identifies one conversation panel instance (a page can embed several). */
  scopeId: string;
  insertion: QuoteInsertion | null;
  /** Drops the insertion once this conversation's composer has applied it. */
  consumeInsertion: (id: string) => void;
  /** Tells the scope whether a composer is mounted and able to take a quote. */
  setComposerReady: (ready: boolean) => void;
}

export const QuoteScopeContext = createContext<QuoteScopeValue | null>(null);

/** The enclosing conversation's quoting scope, or null when quoting is off. */
export function useQuoteScope(): QuoteScopeValue | null {
  return useContext(QuoteScopeContext);
}
