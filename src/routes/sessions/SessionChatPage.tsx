import { Link, useParams } from "@tanstack/react-router";

import { SessionChat } from "@/features/chat/components/SessionChat";
import { useSession } from "@/features/sessions/hooks/useSession";

export function SessionChatPage() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  const { data: session, error } = useSession(sessionId);

  return (
    <main className="mx-auto flex h-svh w-full max-w-2xl flex-col">
      <header className="flex items-center gap-3 border-b p-3">
        <Link
          to="/sessions"
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Sessions
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">
            {session?.name ?? "Session"}
          </h1>
          {session ? (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {session.rootPath}
            </p>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="p-3 text-sm text-destructive">{error.message}</p>
      ) : (
        <SessionChat sessionId={sessionId} />
      )}
    </main>
  );
}
