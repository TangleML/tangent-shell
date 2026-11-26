import {
  type SessionStatusPayload,
  type SessionStatusSnapshotPayload,
  SocketEvents,
} from "@tangent/shared/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, useEffect, useState } from "react";

import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";
import {
  SessionStatusContext,
  type SessionStatusEntry,
  type SessionStatusMap,
} from "@/features/sessions/model/sessionStatusContext";
import { createSocket } from "@/shared/lib/socket";

/**
 * Holds one shared socket subscribed to the sessions lobby and exposes every
 * session's live run status to the list views (the in-chat switcher and the
 * sessions table). Kept separate from the per-chat socket in `useSessionChat`
 * so list status works on any page, independent of which chat is open.
 */
export function SessionStatusProvider({ children }: PropsWithChildren) {
  const [statuses, setStatuses] = useState<SessionStatusMap>(() => new Map());
  const queryClient = useQueryClient();

  useEffect(() => {
    // Same connection style as `useSessionChat` (see createSocket).
    const socket = createSocket();

    socket.on("connect", () => {
      // The snapshot repopulates state on (re)connect, so clear first.
      setStatuses(new Map());
      socket.emit(SocketEvents.SessionStatusSubscribe);
    });

    socket.on(
      SocketEvents.SessionStatusSnapshot,
      ({ statuses: snapshot }: SessionStatusSnapshotPayload) => {
        setStatuses(new Map(snapshot.map((s) => [s.sessionId, toEntry(s)])));
      },
    );

    socket.on(SocketEvents.SessionStatus, (payload: SessionStatusPayload) => {
      setStatuses((prev) => upsertStatus(prev, payload));
      // A turn boundary usually means new messages; refresh list activity.
      void queryClient.invalidateQueries({
        queryKey: SessionQueryKeys.All(),
      });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [queryClient]);

  return (
    <SessionStatusContext.Provider value={statuses}>
      {children}
    </SessionStatusContext.Provider>
  );
}

function toEntry({
  status,
  awaitingInput,
}: SessionStatusPayload): SessionStatusEntry {
  return awaitingInput ? { status, awaitingInput } : { status };
}

/** Returns a new map with the payload's session updated, or removed when it is
 * idle with nothing pending. */
function upsertStatus(
  prev: SessionStatusMap,
  payload: SessionStatusPayload,
): SessionStatusMap {
  const next = new Map(prev);
  if (payload.status === "idle" && !payload.awaitingInput) {
    next.delete(payload.sessionId);
  } else {
    next.set(payload.sessionId, toEntry(payload));
  }
  return next;
}
