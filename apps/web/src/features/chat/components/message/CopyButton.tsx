import { useEffect, useState } from "react";

import { IconButton } from "@/shared/ui/patterns/icon-button";

interface CopyButtonProps {
  content: string;
  kind?: "markdown" | "link";
}

const BUTTON_STATES = {
  markdown: { label: "Copy as Markdown", icon: "Copy" },
  link: { label: "Copy link to message", icon: "Link" },
  copied: { label: "Copied", icon: "Check" },
  failed: { label: "Could not copy", icon: "CircleAlert" },
} as const;

export function CopyButton({ content, kind = "markdown" }: CopyButtonProps) {
  const [feedback, setFeedback] = useState<"copied" | "failed" | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 1500);
    return () => clearTimeout(timer);
  }, [feedback]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setFeedback("copied");
    } catch {
      setFeedback("failed");
    }
  }

  const { label, icon } = BUTTON_STATES[feedback ?? kind];
  return (
    <IconButton
      icon={icon}
      size="xs"
      tone={feedback === "failed" ? "critical" : undefined}
      disabled={!content.trim()}
      title={label}
      aria-label={label}
      onClick={copy}
    />
  );
}
