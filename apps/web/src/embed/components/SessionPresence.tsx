// local primitive

import { Separator } from "@tangent/ui-primitives/separator";

import { useSessionChat } from "@/features/chat/hooks/useSessionChat";
import { useSessionParticipants } from "@/features/chat/hooks/useSessionParticipants";
import { UserAvatarWithTooltip } from "@/features/user/components/UserAvatar";

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
    <div className="my-auto flex min-w-0 items-center gap-2">
      <ul
        aria-label="People in this session"
        className="isolate flex max-w-[min(40vw,20rem)] -space-x-1.5 items-center overflow-x-auto p-0.5"
      >
        {viewers.map(({ id, displayName, presence }, index) => {
          const away = presence === "away";
          return (
            <li
              key={id}
              className="flex shrink-0"
              style={{ zIndex: viewers.length - index }}
            >
              <UserAvatarWithTooltip
                email={id}
                name={displayName}
                label={`${displayName} (${away ? "away" : "active"})`}
                muted={away}
                className="ring-2 ring-background"
              />
            </li>
          );
        })}
      </ul>
      <Separator
        orientation="vertical"
        className="data-[orientation=vertical]:h-5"
      />
    </div>
  );
}
