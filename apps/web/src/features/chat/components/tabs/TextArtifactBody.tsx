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

// Past this a single text block makes the tab sluggish.
const MAX_SHOWN_CHARS = 2_000_000;
const MAX_INDENTED_CHARS = 500_000;

/**
 * JSON written on one line reads better indented. It's only re-indented when
 * parsing and writing it back gives the same text, since that loses detail
 * otherwise: big integers round, `1.0` becomes `1`, repeated keys drop.
 */
function indented(text: string): string {
  const compact = text.trim();
  if (compact.length > MAX_INDENTED_CHARS || compact.includes("\n"))
    return text;
  try {
    const parsed: unknown = JSON.parse(compact);
    return JSON.stringify(parsed) === compact
      ? JSON.stringify(parsed, null, 2)
      : text;
  } catch {
    return text;
  }
}

function readable(text: string, url: string): string {
  if (text.length > MAX_SHOWN_CHARS) {
    return `${text.slice(0, MAX_SHOWN_CHARS)}\n\n… This file is too long to show in full here.`;
  }
  return /\.json(?:[?#]|$)/i.test(url) ? indented(text) : text;
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
