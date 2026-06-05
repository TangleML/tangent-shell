import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { Markdown } from "@/shared/lib/markdown/Markdown";

interface AgentThinkingProps {
  thinking: string;
  /**
   * Whether the agent has moved on from reasoning (the answer has started or
   * the message is finalized). Drives auto-collapse: the disclosure stays open
   * while reasoning is live and collapses once `done` flips true.
   */
  done: boolean;
}

export function AgentThinking({ thinking, done }: AgentThinkingProps) {
  const [open, setOpen] = useState(!done);

  // Sync open state to `done` transitions: expand while thinking, collapse once
  // the answer begins. Manual toggles in between are preserved until `done`
  // flips again.
  useEffect(() => {
    setOpen(!done);
  }, [done]);

  return (
    <div className="flex flex-col gap-1 text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-fit items-center gap-1 text-xs font-medium hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        Thinking
      </button>
      {open ? (
        <Markdown className="text-xs italic">{thinking}</Markdown>
      ) : null}
    </div>
  );
}
