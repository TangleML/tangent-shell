import { Button } from "@tangent/ui-primitives/button";
import { Heading } from "@tangent/ui-primitives/typography";
import type { FallbackProps } from "react-error-boundary";

import { ErrorMessage } from "@/routes/components/ErrorMessage";
import { CenteredScreen } from "@/shared/ui/patterns/centered-screen";

export function RootErrorFallback({
  error,
  resetErrorBoundary,
}: FallbackProps) {
  return (
    <CenteredScreen gap="4" role="alert">
      <Heading level={1} size="xl" weight="semibold">
        Something went wrong
      </Heading>
      <ErrorMessage>
        {error instanceof Error ? error.message : String(error)}
      </ErrorMessage>
      <Button onClick={resetErrorBoundary}>Try again</Button>
    </CenteredScreen>
  );
}
