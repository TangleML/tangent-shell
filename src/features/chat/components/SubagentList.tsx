import { PI_AGENT } from "@shared/contracts";
import { AlertTriangle, Ban, Bot, Check, Crown, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import type { SubagentInfo, SubagentStatus } from "@/features/chat/model/types";
import { cn } from "@/shared/lib/utils";

interface SubagentListProps {
  subagents: SubagentInfo[];
  /** Currently open thread: `null` is Prime's main thread, else a sub-agent id. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Whether a given conversation has a reply streaming right now. */
  isConversationBusy: (conversationId: string) => boolean;
}

const STATUS_LABEL: Record<SubagentStatus, string> = {
  active: "Active",
  completed: "Completed",
  killed: "Killed",
  error: "Error",
};

function StatusIcon({ status }: { status: SubagentStatus }) {
  switch (status) {
    case "active":
      return <Loader2 className="size-3.5 shrink-0 animate-spin text-green-500" />;
    case "completed":
      return <Check className="size-3.5 shrink-0 text-muted-foreground" />;
    case "killed":
      return <Ban className="size-3.5 shrink-0 text-muted-foreground" />;
    case "error":
      return <AlertTriangle className="size-3.5 shrink-0 text-destructive" />;
  }
}

interface RosterButtonProps {
  selected: boolean;
  dimmed: boolean;
  busy: boolean;
  icon: ReactNode;
  title: string;
  primaryClassName?: string;
  primary: string;
  secondary: string;
  onClick: () => void;
}

function RosterButton({
  selected,
  dimmed,
  busy,
  icon,
  title,
  primaryClassName,
  primary,
  secondary,
  onClick,
}: RosterButtonProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
          selected
            ? "bg-accent text-accent-foreground ring-1 ring-border"
            : "hover:bg-muted/60",
          !selected && dimmed ? "opacity-60" : "",
        )}
      >
        <span className="mt-0.5">{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn("truncate text-sm", primaryClassName)}
            title={title}
          >
            {primary}
          </span>
          <span className="text-xs text-muted-foreground">{secondary}</span>
        </span>
        {busy ? (
          <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
      </button>
    </li>
  );
}

// Active sub-agents float to the top so the live roster is easy to scan; ended
// ones (completed/killed/error) settle below in their most recent order.
function sortSubagents(subagents: SubagentInfo[]): SubagentInfo[] {
  return [...subagents].sort((a, b) => {
    const aActive = a.status === "active" ? 0 : 1;
    const bActive = b.status === "active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function SubagentList({
  subagents,
  selectedId,
  onSelect,
  isConversationBusy,
}: SubagentListProps) {
  const activeCount = subagents.filter((s) => s.status === "active").length;

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Bot className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium">Agents</span>
        {activeCount > 0 ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {activeCount} active
          </span>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-1">
          {/* Prime's main thread is always present and selectable. */}
          <RosterButton
            selected={selectedId === null}
            dimmed={false}
            busy={isConversationBusy(PI_AGENT.id)}
            icon={<Crown className="size-3.5 shrink-0 text-amber-500" />}
            title={PI_AGENT.name}
            primaryClassName="font-medium"
            primary={PI_AGENT.name}
            secondary="Main thread"
            onClick={() => onSelect(null)}
          />
          {subagents.length === 0 ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">
              No sub-agents yet. Prime will spawn them as needed.
            </li>
          ) : (
            sortSubagents(subagents).map((subagent) => {
              const isActive = subagent.status === "active";
              return (
                <RosterButton
                  key={subagent.id}
                  selected={selectedId === subagent.id}
                  dimmed={!isActive}
                  busy={isConversationBusy(subagent.id)}
                  icon={<StatusIcon status={subagent.status} />}
                  title={subagent.name}
                  primaryClassName={isActive ? "font-medium" : "line-through"}
                  primary={subagent.name}
                  secondary={`${STATUS_LABEL[subagent.status]}${
                    subagent.template ? ` · ${subagent.template}` : ""
                  }`}
                  onClick={() => onSelect(subagent.id)}
                />
              );
            })
          )}
        </ul>
      </div>
    </aside>
  );
}
