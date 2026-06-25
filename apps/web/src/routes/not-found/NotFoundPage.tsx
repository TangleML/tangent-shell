import { Button } from "@tangent/ui-primitives/button";
import { Heading, Paragraph } from "@tangent/ui-primitives/typography";
import { Link } from "@tanstack/react-router";

import { CenteredScreen } from "@/shared/ui/patterns/centered-screen";

export function NotFoundPage() {
  return (
    <CenteredScreen gap="4">
      <Heading level={1} size="2xl" weight="semibold">
        404 - Page not found
      </Heading>
      <Paragraph tone="subdued" align="center">
        The page you are looking for does not exist.
      </Paragraph>
      <Button asChild>
        <Link to="/">Go home</Link>
      </Button>
    </CenteredScreen>
  );
}
