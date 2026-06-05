import { Link } from "@tanstack/react-router";

import { useCreateSession } from "@/features/sessions/hooks/useCreateSession";
import { useSessions } from "@/features/sessions/hooks/useSessions";
import { Button } from "@/shared/ui/button";

export function SessionsPage() {
  const { data: sessions, isLoading, error } = useSessions();
  const createSession = useCreateSession();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sessions</h1>
          <p className="text-sm text-muted-foreground">
            Each session runs a Pi coding agent in its own scoped folder.
          </p>
        </div>
        <Button
          onClick={() => createSession.mutate({})}
          disabled={createSession.isPending}
        >
          {createSession.isPending ? "Creating..." : "New session"}
        </Button>
      </header>

      {error ? (
        <p className="text-sm text-destructive">
          Failed to load sessions: {error.message}
        </p>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading sessions...</p>
      ) : null}

      {sessions && sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sessions yet. Create one to get started.
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {sessions?.map((session) => (
          <li key={session.id}>
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: session.id }}
              className="flex flex-col rounded-md border p-3 transition-colors hover:bg-accent"
            >
              <span className="font-medium">{session.name}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {session.rootPath}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
