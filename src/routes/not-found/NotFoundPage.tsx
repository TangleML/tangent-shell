import { Link } from "@tanstack/react-router";

import { Button } from "@/shared/ui/button";

export function NotFoundPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">404 - Page not found</h1>
      <p className="text-muted-foreground">
        The page you are looking for does not exist.
      </p>
      <Button asChild>
        <Link to="/">Go home</Link>
      </Button>
    </main>
  );
}
