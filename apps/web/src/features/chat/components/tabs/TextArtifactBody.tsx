import { BlockStack } from "@tangent/ui-primitives/layout";
import { Spinner } from "@tangent/ui-primitives/spinner";

import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";

import { useArtifactText } from "../../hooks/useArtifactText";

interface TextArtifactBodyProps {
  /** Resolved artifact URL under the session file API. */
  url: string;
}

// local primitive — preformatted text in the theme's colors, wrapping long lines.
function PlainText({ children }: { children: string }) {
  return (
    <pre className="min-h-full bg-background p-6 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
      {children}
    </pre>
  );
}

/** Valid JSON reads better indented; anything else is shown as written. */
function readable(text: string, url: string): string {
  if (!/\.json(?:[?#]|$)/i.test(url)) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * Shows a plain-text artifact (text, log, CSV or JSON) in the app's own
 * colors, so it reads in light and dark mode alike.
 */
export function TextArtifactBody({ url }: TextArtifactBodyProps) {
  const { data, isPending, isError } = useArtifactText(url);

  if (isPending) {
    return (
      <BlockStack fill align="center" inlineAlign="center">
        <Spinner />
      </BlockStack>
    );
  }

  if (isError) {
    return (
      <BlockStack fill align="center" inlineAlign="center">
        <EmptyState
          icon="FileText"
          title="Couldn't load this file"
          description="The file could not be fetched. Try opening it in a new tab."
        />
      </BlockStack>
    );
  }

  return (
    <ScrollRegion>
      <PlainText>{readable(data, url)}</PlainText>
    </ScrollRegion>
  );
}
