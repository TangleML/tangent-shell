import { Link } from "@tanstack/react-router";

import { Button } from "@/shared/ui/button";
import { CenteredScreen } from "@/shared/ui/patterns/centered-screen";
import { Heading, Paragraph } from "@/shared/ui/typography";

export function HomePage() {
  return (
    <CenteredScreen>
      <Heading level={1} size="2xl" weight="bold">
        Tangent Instance
      </Heading>
      <Paragraph tone="subdued" align="center">
        Vite + React 19 + slim FSD scaffold, compiled with React Compiler.
      </Paragraph>
      <Button asChild>
        <Link to="/sessions">Open sessions</Link>
      </Button>
    </CenteredScreen>
  );
}
