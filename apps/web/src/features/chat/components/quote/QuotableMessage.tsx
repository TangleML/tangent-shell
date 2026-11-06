import type { ReactNode } from "react";

import {
  QUOTE_MESSAGE_ATTR,
  QUOTE_SCOPE_ATTR,
} from "@/features/chat/model/quoting";

import { useQuoteScope } from "./quoteScope";

interface QuotableMessageProps {
  messageId: string;
  children: ReactNode;
}

/**
 * local primitive — tags a message body so a selection inside it can be quoted.
 * `display: contents` keeps the bubble's own layout untouched.
 */
export function QuotableMessage({ messageId, children }: QuotableMessageProps) {
  const scope = useQuoteScope();
  if (!scope) return <>{children}</>;

  const marks = {
    [QUOTE_MESSAGE_ATTR]: messageId,
    [QUOTE_SCOPE_ATTR]: scope.scopeId,
  };

  return (
    <div className="contents" {...marks}>
      {children}
    </div>
  );
}
