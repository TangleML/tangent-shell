import type { IconName } from "@tangent/ui-primitives/icon";
import { type KeyboardEvent, type RefObject, useState } from "react";

import {
  type ActiveMention,
  applyToken,
  type ComposerTrigger,
  findActiveMention,
} from "@/features/chat/model/mentions";

const TRIGGERS: readonly ComposerTrigger[] = ["@", "#"];

/** One row of a composer picker, and the token choosing it inserts. */
export interface ComposerSuggestion {
  key: string;
  label: string;
  token: string;
  icon?: IconName;
  group?: string;
  groupDetail?: string;
  detail?: string;
  onAccept?: () => void;
}

interface UseComposerAutocompleteArgs {
  value: string;
  onValueChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  suggest: (trigger: ComposerTrigger, query: string) => ComposerSuggestion[];
}

function activeAt(value: string, caret: number): ActiveMention | null {
  let nearest: ActiveMention | null = null;
  for (const trigger of TRIGGERS) {
    const active = findActiveMention(value, caret, trigger);
    if (active && (!nearest || active.start > nearest.start)) nearest = active;
  }
  return nearest;
}

/**
 * Drives the composer's pickers: `@` to address someone, `#` to reference
 * something. It tracks the trigger the caret is inside, asks for suggestions,
 * and owns the keyboard interaction (arrow to move, Enter/Tab to accept,
 * Escape to dismiss). A choice only ever inserts a readable token; mentions
 * resolve on the server, references when the message is sent.
 */
export function useComposerAutocomplete({
  value,
  onValueChange,
  textareaRef,
  suggest,
}: UseComposerAutocompleteArgs) {
  const [active, setActive] = useState<ActiveMention | null>(null);
  const [highlight, setHighlight] = useState(0);

  const matches = active ? suggest(active.trigger, active.query) : [];
  const open = active != null && matches.length > 0;

  function sync(target: HTMLTextAreaElement) {
    setActive(activeAt(target.value, target.selectionStart ?? 0));
    setHighlight(0);
  }

  function close() {
    setActive(null);
  }

  function accept(suggestion: ComposerSuggestion) {
    const el = textareaRef.current;
    if (!active || !el) return;
    const result = applyToken(
      value,
      el.selectionStart ?? value.length,
      active,
      suggestion.token,
    );
    suggestion.onAccept?.();
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
