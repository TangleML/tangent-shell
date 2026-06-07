import { type KeyboardEvent, useState } from "react";

import { Box } from "@/shared/ui/box";
import { InlineStack } from "@/shared/ui/layout";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { Textarea } from "@/shared/ui/textarea";

interface ChatInputProps {
  disabled?: boolean;
  onSubmit: (content: string) => void;
}

export function ChatInput({ disabled, onSubmit }: ChatInputProps) {
  const [value, setValue] = useState("");

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    setValue("");
    onSubmit(trimmed);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <Box borderBlockStart="sm" padding="sm" inlineSize="full">
      <InlineStack gap="2" blockAlign="start" wrap="nowrap" fill>
        <Textarea
          autoGrow
          rows={2}
          placeholder="Message the session..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <IconButton
          icon="Send"
          variant="outline"
          size="lg"
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
        />
      </InlineStack>
    </Box>
  );
}
