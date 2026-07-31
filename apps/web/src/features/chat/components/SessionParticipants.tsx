import type { SessionParticipant } from "@tangent/shared/contracts";

import { UserAvatar } from "@/features/user/components/UserAvatar";
import { cn } from "@/shared/lib/utils";

interface SessionParticipantsProps {
  participants: SessionParticipant[];
}

/** First-letter initials from a display name, e.g. "John S." -> "JS". */
function initialsFromName(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("");
  return letters.slice(0, 2).toUpperCase() || "?";
}

/**
 * SessionParticipants — a row of slightly overlapping avatars for the humans in
 * a session. Users currently connected over the socket render in color; users
 * who only authored a message (and are not connected) render grayscale.
 *
 * Styles raw `<div>`/`<span>` (the sanctioned escape hatch, like `StatusDot`),
 * so it is exempt from `tangle-ui/no-classname-on-primitives`.
 */
export function SessionParticipants({
  participants,
}: SessionParticipantsProps) {
  if (participants.length === 0) return null;

  return (
    // local primitive
    <div className="flex -space-x-2">
      {participants.map((participant) => {
        const title = participant.active
          ? `${participant.name} (active)`
          : participant.name;
        const fallback = (
          // local primitive
          <div
            title={title}
            aria-label={title}
            className={cn(
              "flex size-6 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-secondary-foreground",
              !participant.active && "opacity-70 grayscale",
            )}
          >
            {initialsFromName(participant.name)}
          </div>
        );

        return (
          // local primitive
          <span
            key={participant.id}
            title={title}
            className="rounded-full ring-2 ring-background"
          >
            <UserAvatar
              email={participant.id}
              name={title}
              size="sm"
              grayscale={!participant.active}
              fallback={fallback}
            />
          </span>
        );
      })}
    </div>
  );
}
