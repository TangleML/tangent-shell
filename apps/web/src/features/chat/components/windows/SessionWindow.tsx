import { SessionCard } from "../sidebar/sessions/SessionCard";
import { useSessionChatWindowsContext } from "./SessionChatWindowsContext";

export function SessionWindow() {
  const { sessionId, draft, session, connected } =
    useSessionChatWindowsContext();

  return (
    <SessionCard
      currentSessionId={sessionId}
      name={draft ? "New session" : (session?.name ?? "Session")}
      rootPath={session?.rootPath}
      connected={connected}
    />
  );
}
