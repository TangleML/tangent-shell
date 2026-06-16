import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { SessionStatusProvider } from "@/features/sessions/components/SessionStatusProvider";
import { queryClient } from "@/shared/api/queryClient";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";

import { RootErrorFallback } from "./RootErrorFallback";

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ErrorBoundary FallbackComponent={RootErrorFallback}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SessionStatusProvider>{children}</SessionStatusProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
