import type { Attachment } from "@shared/contracts";
import { type ChangeEvent, type KeyboardEvent, useRef, useState } from "react";

import { uploadFiles } from "@/features/sessions/api/sessionsApi";
import { Box } from "@/shared/ui/box";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { Pill } from "@/shared/ui/patterns/pill";
import { Textarea } from "@/shared/ui/textarea";

interface ChatInputProps {
  sessionId: string;
  disabled?: boolean;
  /** Whether the agent is mid-run; swaps Send for a Stop control. */
  agentBusy?: boolean;
  /** Aborts the agent's in-progress run. Required for the Stop control. */
  onAbort?: () => void;
  onSubmit: (content: string, attachments?: Attachment[]) => void;
}

export function ChatInput({
  sessionId,
  disabled,
  agentBusy,
  onAbort,
  onSubmit,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = disabled || uploading;
  const canSubmit = !busy && (value.trim().length > 0 || files.length > 0);
  // While the agent is running, the trailing action becomes "Stop" so the user
  // can abort mid-run even though the rest of the composer is disabled.
  const showStop = Boolean(agentBusy && onAbort);

  function handleFilesPicked(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    if (picked.length) setFiles((prev) => [...prev, ...picked]);
    // Reset so picking the same file again still fires `onChange`.
    e.target.value = "";
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    const trimmed = value.trim();
    if (busy || (!trimmed && files.length === 0)) return;

    let attachments: Attachment[] | undefined;
    if (files.length > 0) {
      setUploading(true);
      try {
        attachments = await uploadFiles(sessionId, files);
      } catch (err) {
        console.error("[chat] file upload failed:", err);
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    setValue("");
    setFiles([]);
    onSubmit(trimmed, attachments);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <Box borderBlockStart="sm" padding="sm" inlineSize="full">
      <BlockStack gap="2">
        {files.length > 0 ? (
          <InlineStack gap="1" wrap="wrap">
            {files.map((file, index) => (
              <Pill key={`${file.name}-${index}`} tone="subdued">
                <Icon name="File" size="xs" />
                {file.name}
                <IconButton
                  icon="X"
                  size="xs"
                  variant="ghost"
                  onClick={() => removeFile(index)}
                  disabled={uploading}
                  aria-label={`Remove ${file.name}`}
                />
              </Pill>
            ))}
          </InlineStack>
        ) : null}
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
          <Textarea
            autoGrow
            rows={2}
            placeholder="Message the session..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy}
          />
          {showStop ? (
            <IconButton
              icon="Square"
              variant="outline"
              size="lg"
              onClick={onAbort}
              aria-label="Stop"
            />
          ) : (
            <IconButton
              icon="Send"
              variant="outline"
              size="lg"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              aria-label="Send message"
            />
          )}
        </InlineStack>
      </BlockStack>
    </Box>
  );
}
