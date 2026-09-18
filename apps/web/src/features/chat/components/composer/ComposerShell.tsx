import { Box } from "@tangent/ui-primitives/box";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Textarea } from "@tangent/ui-primitives/textarea";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  useRef,
} from "react";

import type { MentionCandidate } from "@/features/chat/model/mentions";
import { IconButton } from "@/shared/ui/patterns/icon-button";

import { FileDropZone } from "./FileDropZone";
import { MentionPicker } from "./MentionPicker";
import { useMentionAutocomplete } from "./useMentionAutocomplete";

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

interface ComposerShellProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onAttach: (files: File[]) => void;
  canSend: boolean;
  busy?: boolean;
  placeholder?: string;
  hideSend?: boolean;
  /** People/agents the `@mention` picker can address; omitted disables it. */
  mentionCandidates?: MentionCandidate[];
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
  mentionCandidates = [],
  children,
}: ComposerShellProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mention = useMentionAutocomplete({
    candidates: mentionCandidates,
    value,
    onValueChange,
    textareaRef,
  });

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
    mention.sync(e.target);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.handleKeyDown(e)) return;
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
            {/* local primitive — relative anchor for the floating mention picker. */}
            <div className="relative flex-1">
              {mention.open ? (
                <MentionPicker
                  candidates={mention.matches}
                  highlight={mention.highlight}
                  onSelect={mention.accept}
                />
              ) : null}
              <Textarea
                ref={textareaRef}
                autoGrow
                rows={2}
                placeholder={placeholder}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onSelect={(e: SyntheticEvent<HTMLTextAreaElement>) =>
                  mention.sync(e.currentTarget)
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
