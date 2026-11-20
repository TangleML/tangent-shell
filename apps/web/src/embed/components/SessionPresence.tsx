// local primitive

import { useSessionChat } from "@/features/chat/hooks/useSessionChat";
import { useSessionParticipants } from "@/features/chat/hooks/useSessionParticipants";
import { UserAvatar } from "@/features/user/components/UserAvatar";
import { cn } from "@/shared/lib/utils";

export function SessionPresence({ sessionId }: { sessionId: string }) {
  const { connected, currentAuthorId, historyLoaded } =
    useSessionChat(sessionId);
  const { data: participants } = useSessionParticipants(
    historyLoaded ? sessionId : "",
  );
  const viewers = participants?.filter(
    (person) =>
      person.kind === "human" &&
      !person.revokedAt &&
      person.presence !== "detached",
  );
  if (!connected || !viewers?.some((person) => person.id === currentAuthorId)) {
    return null;
  }

  return (
    <ul
      aria-label="People in this session"
      className="my-auto flex max-w-[min(40vw,20rem)] -space-x-1.5 items-center overflow-x-auto p-0.5"
    >
      {viewers.map(({ id, displayName, presence }) => {
        const away = presence === "away";
        const label = `${displayName} (${away ? "tab unfocused" : "tab focused"})`;
        return (
          <li
            key={id}
            className={cn(
              "flex shrink-0 rounded-full ring-2 ring-background",
              away && "opacity-55 grayscale",
            )}
          >
            <UserAvatar email={id} name={displayName} label={label} />
          </li>
        );
      })}
    </ul>
  );
}
