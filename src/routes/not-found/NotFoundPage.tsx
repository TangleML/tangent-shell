import { Link } from "@tanstack/react-router";

import { Button } from "@/shared/ui/button";
import { CenteredScreen } from "@/shared/ui/patterns/centered-screen";
import { Heading, Paragraph } from "@/shared/ui/typography";

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
