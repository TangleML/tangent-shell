import { useNavigate } from "@tanstack/react-router";

import { useSessions } from "@/features/sessions/hooks/useSessions";

/**
 * Shared selection logic for the session switchers: the list of sessions other
 * than the current one and a navigate-on-select handler. Consumed by both the
 * list-style {@link SessionSwitcher} and the {@link SessionDropDownSwitcher}.
 */
export function useSessionSwitcher(currentSessionId: string) {
  const { data: sessions } = useSessions();
  const navigate = useNavigate();

  const otherSessions = sessions?.filter(
    (session) => session.id !== currentSessionId,
  );

  const onSelect = (id: string) => {
    if (id === currentSessionId) return;
    void navigate({ to: "/sessions/$sessionId", params: { sessionId: id } });
  };

  return { sessions, otherSessions, onSelect };
}
