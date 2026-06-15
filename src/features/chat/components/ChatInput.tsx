import type { Attachment, MessageDelivery } from "@shared/contracts";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { uploadFiles } from "@/features/sessions/api/sessionsApi";
import { Box } from "@/shared/ui/box";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { Pill } from "@/shared/ui/patterns/pill";
import { Textarea } from "@/shared/ui/textarea";

import { FileDropZone } from "./FileDropZone";
import { QueuedFollowUps } from "./QueuedFollowUps";

/** A follow-up message held client-side while the agent is mid-run. */
interface QueuedMessage {
  id: string;
  content: string;
  attachments?: Attachment[];
}

interface ChatInputProps {
  sessionId: string;
  /** Disables the whole composer (e.g. while the socket is disconnected). */
  disabled?: boolean;
  /**
   * Whether the target agent is mid-run. When busy, the composer stays usable
   * and surfaces Stop / Steer / Follow up controls above the input so the user
   * can nudge the agent without waiting for it to finish.
   */
  agentBusy?: boolean;
  /** Aborts the agent's in-progress run. Required for the Stop control. */
  onAbort?: () => void;
  onSubmit: (
    content: string,
    options: { delivery: MessageDelivery; attachments?: Attachment[] },
  ) => void;
  /**
   * Server-mirrored steer/follow-up queue from Pi. Superseded by the
   * client-side follow-up queue (see {@link QueuedFollowUps}) and currently
   * unused; kept so existing call sites compile without changes.
   */
  queued?: { steering: string[]; followUp: string[] } | null;
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
  // Follow-ups composed while the agent is busy wait here until the run ends
  // (auto-drained) or the user sends one immediately. They never become chat
  // bubbles until actually sent, so the transcript stays clean.
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tracks the previous busy state so we can detect the run-end transition and
  // flush the queue exactly once when the agent stops.
  const wasBusyRef = useRef(agentBusy);

  const busy = disabled || uploading;
  const canSubmit = !busy && (value.trim().length > 0 || files.length > 0);

  function addFiles(picked: File[]) {
    if (picked.length) setFiles((prev) => [...prev, ...picked]);
  }

  function handleFilesPicked(e: ChangeEvent<HTMLInputElement>) {
    addFiles(e.target.files ? Array.from(e.target.files) : []);
    // Reset so picking the same file again still fires `onChange`.
    e.target.value = "";
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (busy) return;
    const images: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (!item.type.startsWith("image/")) continue;
      const blob = item.getAsFile();
      if (!blob) continue;
      // Pasted blobs are often named generically (e.g. "image.png"), so derive
      // a unique, readable name from the MIME subtype to disambiguate pills.
      const ext = blob.type.split("/")[1] || "png";
      const named = new File([blob], `pasted-${Date.now()}.${ext}`, {
        type: blob.type,
      });
      images.push(named);
    }
    if (images.length === 0) return;
    // Prevent a screenshot-only paste from also inserting placeholder content.
    e.preventDefault();
    addFiles(images);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // Uploads the staged files and returns their attachment refs. `undefined`
  // means nothing was staged; `null` signals an upload failure (callers abort).
  async function uploadStagedFiles(): Promise<Attachment[] | undefined | null> {
    if (files.length === 0) return undefined;
    setUploading(true);
    try {
      const attachments = await uploadFiles(sessionId, files);
      setUploading(false);
      return attachments;
    } catch (err) {
      console.error("[chat] file upload failed:", err);
      setUploading(false);
      return null;
    }
  }

  async function handleSubmit(delivery: MessageDelivery) {
    const trimmed = value.trim();
    if (busy || (!trimmed && files.length === 0)) return;

    const attachments = await uploadStagedFiles();
    if (attachments === null) return;

    setValue("");
    setFiles([]);
    onSubmit(trimmed, { delivery, attachments });
  }

  // Adds the composed message to the client-side follow-up queue instead of
  // sending it, so nothing reaches the agent (or the transcript) until the run
  // ends or the user sends it immediately.
  async function enqueueFollowUp() {
    const trimmed = value.trim();
    if (busy || (!trimmed && files.length === 0)) return;

    const attachments = await uploadStagedFiles();
    if (attachments === null) return;

    setValue("");
    setFiles([]);
    setQueue((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        content: trimmed,
        attachments: attachments ?? undefined,
      },
    ]);
  }

  // Jumps a queued item to the front: removes it and steers it into the live
  // run right away (a true mid-run nudge).
  function sendQueuedNow(id: string) {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    setQueue((prev) => prev.filter((q) => q.id !== id));
    onSubmit(item.content, {
      delivery: "steer",
      attachments: item.attachments,
    });
  }

  function discardQueued(id: string) {
    setQueue((prev) => prev.filter((q) => q.id !== id));
  }

  // Flush the queue when the run ends: send every waiting follow-up in order as
  // a normal prompt (Pi queues any that land while it's still finishing up).
  useEffect(() => {
    const wasBusy = wasBusyRef.current;
    wasBusyRef.current = agentBusy;
    if (!wasBusy || agentBusy || queue.length === 0) return;

    const pending = queue;
    setQueue([]);
    for (const item of pending) {
      onSubmit(item.content, {
        delivery: "auto",
        attachments: item.attachments,
      });
    }
  }, [agentBusy, queue, onSubmit]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // While the agent is running, Enter queues a follow-up; otherwise it
      // sends the message immediately.
      if (agentBusy) {
        void enqueueFollowUp();
        return;
      }
      void handleSubmit("auto");
    }
  }

  return (
    <FileDropZone onFilesDropped={addFiles} disabled={busy}>
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
          {/* Queued follow-ups wait above the input until the run ends (then
              they auto-send) or the user sends one immediately. */}
          <QueuedFollowUps
            items={queue}
            onSendNow={sendQueuedNow}
            onDiscard={discardQueued}
            disabled={busy}
          />
          {/* Run controls sit on their own row, left-aligned, immediately above
              the input so they're easy to spot while the agent is working. */}
          {agentBusy ? (
            <InlineStack gap="2" blockAlign="center" wrap="wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={onAbort}
                disabled={!onAbort}
              >
                <Icon name="Square" size="xs" />
                Stop
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleSubmit("steer")}
                disabled={!canSubmit}
              >
                <Icon name="Send" size="xs" />
                Steer
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void enqueueFollowUp()}
                disabled={!canSubmit}
              >
                <Icon name="Clock" size="xs" />
                Follow up
              </Button>
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
              placeholder={
                agentBusy ? "Nudge the agent..." : "Message the session..."
              }
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={busy}
            />
            {agentBusy ? null : (
              <IconButton
                icon="Send"
                variant="outline"
                size="lg"
                onClick={() => void handleSubmit("auto")}
                disabled={!canSubmit}
                aria-label="Send message"
              />
            )}
          </InlineStack>
        </BlockStack>
      </Box>
    </FileDropZone>
  );
}
