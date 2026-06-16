import { useNavigate } from "@tanstack/react-router";

import { useSessions } from "@/features/sessions/hooks/useSessions";

/**
 * Shared selection logic for the session switchers: the list of sessions other
 * than the current one and a navigate-on-select handler. Consumed by both the
 * list-style {@link SessionSwitcher} and the {@link SessionDropDownSwitcher}.
 */
export function useSessionSwitcher(currentSessionId: string) {
  const { data: allSessions } = useSessions();
  const navigate = useNavigate();

  // Archived sessions are hidden from the in-chat switcher.
  const sessions = allSessions?.filter((session) => !session.archived);
  const otherSessions = sessions?.filter(
    (session) => session.id !== currentSessionId,
  );

  const onSelect = (id: string) => {
    if (id === currentSessionId) return;
    void navigate({ to: "/sessions/$sessionId", params: { sessionId: id } });
  };

  // Deleting the session currently being viewed leaves nowhere to stay, so
  // fall back to the sessions index.
  const onDeleted = (id: string) => {
    if (id !== currentSessionId) return;
    void navigate({ to: "/sessions" });
  };

  return { sessions, otherSessions, onSelect, onDeleted };
}
