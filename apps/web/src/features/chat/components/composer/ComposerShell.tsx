import { Box } from "@tangent/ui-primitives/box";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Textarea } from "@tangent/ui-primitives/textarea";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useRef,
} from "react";

import {
  type ChatCommand,
  filterCommands,
} from "@/features/chat/model/commands";
import {
  type ComposerTrigger,
  filterMentionCandidates,
  type MentionCandidate,
  mentionToken,
} from "@/features/chat/model/mentions";
import {
  type ChatReference,
  groupReferences,
  type PickedReferences,
  referenceToken,
} from "@/features/chat/model/references";
import { IconButton } from "@/shared/ui/patterns/icon-button";

import { FileDropZone } from "./FileDropZone";
import { SuggestionPicker } from "./SuggestionPicker";
import {
  type ComposerSuggestion,
  useComposerAutocomplete,
} from "./useComposerAutocomplete";

// Pasted blobs are often named generically, so derive a unique, readable name
// from the MIME subtype to disambiguate the staged-file pills.
function extractPastedImages(e: ClipboardEvent): File[] {
  const images: File[] = [];
  for (const item of Array.from(e.clipboardData.items)) {
    if (!item.type.startsWith("image/")) continue;
    const blob = item.getAsFile();
    if (!blob) continue;
    const ext = blob.type.split("/")[1] || "png";
    images.push(
      new File([blob], `pasted-${Date.now()}.${ext}`, { type: blob.type }),
    );
  }
  return images;
}

/** What the `#` picker offers, and where a pick is recorded for sending. */
export interface ComposerReferences {
  candidates: ChatReference[];
  picked: PickedReferences;
  onPick: (token: string, reference: ChatReference) => void;
}

function suggestionsFor(
  trigger: ComposerTrigger,
  query: string,
  mentionCandidates: MentionCandidate[],
  references: ComposerReferences | undefined,
  commands: readonly ChatCommand[],
): ComposerSuggestion[] {
  if (trigger === "/") {
    return filterCommands(commands, query).map((command) => ({
      key: `command:${command.name}`,
      label: command.argumentHint
        ? `/${command.name} ${command.argumentHint}`
        : `/${command.name}`,
      token: `/${command.name}`,
      icon: "SquareSlash",
      detail: command.description,
    }));
  }
  if (trigger === "@") {
    return filterMentionCandidates(mentionCandidates, query).map(
      (candidate) => ({
        key: candidate.id,
        label: candidate.name,
        token: mentionToken(candidate),
      }),
    );
  }
  if (!references) return [];
  return groupReferences(references.candidates, query).flatMap((group) => {
    const shown = group.references.length;
    const groupDetail =
      group.total > shown ? `${shown} of ${group.total}` : undefined;
    return group.references.map((reference) => {
      const token = referenceToken(reference, references.picked);
      return {
        key: `${reference.kind}:${reference.href}`,
        label: reference.label,
        token,
        icon: group.icon,
        group: group.title,
        groupDetail,
        detail: reference.detail,
        onAccept: () => references.onPick(token, reference),
      };
    });
  });
}

interface ComposerShellProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onAttach: (files: File[]) => void;
  canSend: boolean;
  busy?: boolean;
  placeholder?: string;
  hideSend?: boolean;
  /**
   * Focuses the input as soon as the composer is usable, once per mount. The
   * textarea starts disabled (socket/roster not ready) and cannot take focus
   * then, so this waits for `busy` to clear instead of using DOM autofocus.
   */
  autoFocus?: boolean;
  /** People/agents the `@mention` picker can address; omitted disables it. */
  mentionCandidates?: MentionCandidate[];
  /** What the `#` picker can reference; omitted disables it. */
  references?: ComposerReferences;
  /** What the `/` picker can run; omitted disables it. */
  commands?: readonly ChatCommand[];
  children?: ReactNode;
}

export function ComposerShell({
  value,
  onValueChange,
  onSubmit,
  onAttach,
  canSend,
  busy,
  placeholder = "Message the session...",
  hideSend,
  autoFocus,
  mentionCandidates = [],
  references,
  commands = [],
  children,
}: ComposerShellProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoFocusedRef = useRef(false);
  const autocomplete = useComposerAutocomplete({
    value,
    onValueChange,
    textareaRef,
    suggest: (trigger, query) =>
      suggestionsFor(trigger, query, mentionCandidates, references, commands),
  });

  useEffect(() => {
    if (!autoFocus || busy || autoFocusedRef.current) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    autoFocusedRef.current = true;
    // Embedded in a host page — don't scroll the host to reach the composer.
    textarea.focus({ preventScroll: true });
  }, [autoFocus, busy]);

  function handleFilesPicked(e: ChangeEvent<HTMLInputElement>) {
    onAttach(e.target.files ? Array.from(e.target.files) : []);
    e.target.value = "";
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (busy) return;
    const images = extractPastedImages(e);
    if (images.length === 0) return;
    e.preventDefault();
    onAttach(images);
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    onValueChange(e.target.value);
    autocomplete.sync(e.target);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (autocomplete.handleKeyDown(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <FileDropZone onFilesDropped={onAttach} disabled={busy}>
      <Box borderBlockStart="sm" padding="sm" inlineSize="full">
        <BlockStack gap="2">
          {children}
          <InlineStack gap="2" blockAlign="start" wrap="nowrap" fill>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={handleFilesPicked}
            />
            <IconButton
              icon="Paperclip"
              variant="outline"
              size="lg"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              aria-label="Attach files"
            />
            {/* local primitive — relative anchor for the floating suggestion picker. */}
            <div className="relative flex-1">
              {autocomplete.open ? (
                <SuggestionPicker
                  id={autocomplete.listboxId}
                  optionId={autocomplete.optionId}
                  suggestions={autocomplete.matches}
                  highlight={autocomplete.highlight}
                  onSelect={autocomplete.accept}
                />
              ) : null}
              <Textarea
                ref={textareaRef}
                autoGrow
                rows={2}
                placeholder={placeholder}
                aria-autocomplete="list"
                aria-controls={
                  autocomplete.open ? autocomplete.listboxId : undefined
                }
                aria-activedescendant={autocomplete.activeOptionId}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onSelect={(e: SyntheticEvent<HTMLTextAreaElement>) =>
                  autocomplete.sync(e.currentTarget)
                }
                disabled={busy}
              />
            </div>
            {hideSend ? null : (
              <IconButton
                icon="Send"
                variant="outline"
                size="lg"
                onClick={onSubmit}
                disabled={!canSend}
                aria-label="Send message"
              />
            )}
          </InlineStack>
        </BlockStack>
      </Box>
    </FileDropZone>
  );
}
