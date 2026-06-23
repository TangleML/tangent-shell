import { useState } from "react";

import { ComposerShell } from "./ComposerShell";

interface NewSessionComposerProps {
  onSend: (content: string) => void;
  onAttach: (files: File[], content: string) => void;
  busy?: boolean;
}

export function NewSessionComposer({
  onSend,
  onAttach,
  busy,
}: NewSessionComposerProps) {
  const [value, setValue] = useState("");

  const canSend = !busy && value.trim().length > 0;

  function handleSend() {
    if (!canSend) return;
    onSend(value.trim());
  }

  function attach(files: File[]) {
    if (busy || files.length === 0) return;
    onAttach(files, value.trim());
  }

  return (
    <ComposerShell
      value={value}
      onValueChange={setValue}
      onSubmit={handleSend}
      onAttach={attach}
      canSend={canSend}
      busy={busy}
    />
  );
}
