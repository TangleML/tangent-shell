import {
  type SessionRunStatus,
  type SessionStatusPayload,
  type SessionStatusSnapshotPayload,
  SocketEvents,
} from "@tangent/shared/contracts";
import { type PropsWithChildren, useEffect, useState } from "react";
import { io } from "socket.io-client";

import {
  SessionStatusContext,
  type SessionStatusMap,
} from "@/features/sessions/model/sessionStatusContext";
import { BASE_PREFIX } from "@/shared/lib/basePath";

/**
 * Holds one shared socket subscribed to the sessions lobby and exposes every
 * session's live run status to the list views (the in-chat switcher and the
 * sessions table). Kept separate from the per-chat socket in `useSessionChat`
 * so list status works on any page, independent of which chat is open.
 */
export function SessionStatusProvider({ children }: PropsWithChildren) {
  const [statuses, setStatuses] = useState<SessionStatusMap>(() => new Map());

  useEffect(() => {
    // Same connection style as `useSessionChat`: Vite proxies /socket.io to the
    // dev server, and the path is mount-prefix aware for the pod-proxy sub-path.
    const socket = io({ autoConnect: true, path: `${BASE_PREFIX}socket.io` });

    socket.on("connect", () => {
      // The snapshot repopulates state on (re)connect, so clear first.
      setStatuses(new Map());
      socket.emit(SocketEvents.SessionStatusSubscribe);
    });

    socket.on(
      SocketEvents.SessionStatusSnapshot,
      ({ statuses: snapshot }: SessionStatusSnapshotPayload) => {
        setStatuses(new Map(snapshot.map((s) => [s.sessionId, s.status])));
      },
    );

    socket.on(
      SocketEvents.SessionStatus,
      ({ sessionId, status }: SessionStatusPayload) => {
        setStatuses((prev) => upsertStatus(prev, sessionId, status));
      },
    );

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  return (
    <SessionStatusContext.Provider value={statuses}>
      {children}
    </SessionStatusContext.Provider>
  );
}

/** Returns a new map with `sessionId` set to `status` (or removed when idle). */
function upsertStatus(
  prev: SessionStatusMap,
  sessionId: string,
  status: SessionRunStatus,
): SessionStatusMap {
  const next = new Map(prev);
  if (status === "idle") {
    next.delete(sessionId);
  } else {
    next.set(sessionId, status);
  }
  return next;
}
