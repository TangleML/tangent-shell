import type { FallbackProps } from "react-error-boundary";

import { Button } from "@/shared/ui/button";

export function RootErrorFallback({
  error,
  resetErrorBoundary,
}: FallbackProps) {
  return (
    <div
      role="alert"
      className="flex min-h-svh flex-col items-center justify-center gap-4 p-6"
    >
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <pre className="max-w-lg overflow-auto rounded-md bg-muted p-4 text-sm text-muted-foreground">
        {error instanceof Error ? error.message : String(error)}
      </pre>
      <Button onClick={resetErrorBoundary}>Try again</Button>
    </div>
  );
}
