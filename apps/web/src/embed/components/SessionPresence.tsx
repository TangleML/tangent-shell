// local primitive

import { BlockStack } from "@tangent/ui-primitives/layout";
import { Separator } from "@tangent/ui-primitives/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@tangent/ui-primitives/tooltip";
import { Text } from "@tangent/ui-primitives/typography";

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
    <div className="my-auto flex min-w-0 items-center gap-2">
      <ul
        aria-label="People in this session"
        className="flex max-w-[min(40vw,20rem)] -space-x-1.5 items-center overflow-x-auto p-0.5"
      >
        {viewers.map(({ id, displayName, presence }) => {
          const away = presence === "away";
          const status = away ? "Tab unfocused" : "Tab focused";
          return (
            <li key={id} className="flex shrink-0 focus-within:z-10">
              <Tooltip>
                <TooltipTrigger
                  aria-label={`${displayName} (${status})`}
                  className={cn(
                    "flex cursor-help rounded-full ring-2 ring-background focus-visible:outline-2 focus-visible:outline-ring",
                    away && "opacity-55 grayscale",
                  )}
                >
                  <UserAvatar email={id} name={displayName} />
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  <BlockStack gap="0.5">
                    <Text size="sm" weight="semibold" tone="on-primary">
                      {displayName}
                    </Text>
                    {id.includes("@") && id !== displayName && (
                      <Text size="xs" tone="on-primary">
                        {id}
                      </Text>
                    )}
                    <Text size="xs" tone="on-primary">
                      {status}
                    </Text>
                  </BlockStack>
                </TooltipContent>
              </Tooltip>
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
