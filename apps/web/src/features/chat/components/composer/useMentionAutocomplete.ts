import { type KeyboardEvent, type RefObject, useState } from "react";

import {
  type ActiveMention,
  applyMention,
  filterMentionCandidates,
  findActiveMention,
  type MentionCandidate,
} from "@/features/chat/model/mentions";

interface UseMentionAutocompleteArgs {
  candidates: MentionCandidate[];
  value: string;
  onValueChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

/**
 * Drives the composer's `@mention` picker: it tracks the mention the caret is
 * inside, filters candidates, and owns the keyboard interaction (arrow to move,
 * Enter/Tab to accept, Escape to dismiss). The picker only ever inserts a name
 * token; the server resolves it to a stable id at write time.
 */
export function useMentionAutocomplete({
  candidates,
  value,
  onValueChange,
  textareaRef,
}: UseMentionAutocompleteArgs) {
  const [active, setActive] = useState<ActiveMention | null>(null);
  const [highlight, setHighlight] = useState(0);

  const matches = active
    ? filterMentionCandidates(candidates, active.query)
    : [];
  const open = active != null && matches.length > 0;

  function sync(target: HTMLTextAreaElement) {
    const next = findActiveMention(target.value, target.selectionStart ?? 0);
    setActive(next);
    setHighlight(0);
  }

  function close() {
    setActive(null);
  }

  function accept(candidate: MentionCandidate) {
    const el = textareaRef.current;
    if (!active || !el) return;
    const result = applyMention(
      value,
      el.selectionStart ?? value.length,
      active,
      candidate,
    );
    onValueChange(result.value);
    setActive(null);
    // Restore the caret after the controlled re-render lands the new text.
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(result.caret, result.caret);
    });
  }

  /** Returns true when the picker consumed the key (so send/newline is skipped). */
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % matches.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + matches.length) % matches.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(matches[highlight] ?? matches[0]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return true;
    }
    return false;
  }

  return { open, matches, highlight, sync, accept, handleKeyDown };
}
