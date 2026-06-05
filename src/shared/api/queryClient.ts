import { QueryClient } from "@tanstack/react-query";

// Module-level singleton so the client identity stays stable across renders
// (see react-best-practices.md: context providers should provide stable values).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      refetchOnWindowFocus: false,
    },
  },
});
