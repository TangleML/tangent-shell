import { Box } from "@tangent/ui-primitives/box";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { Spinner } from "@tangent/ui-primitives/spinner";

import { apiUrl } from "@/shared/lib/basePath";
import { Markdown } from "@/shared/lib/markdown/Markdown";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";

import { useArtifactText } from "../../hooks/useArtifactText";

interface ArtifactMarkdownContentProps {
  /** Session that owns the artifact; used to resolve relative references. */
  sessionId: string;
  /** Resolved artifact URL under the session file API. */
  url: string;
}

/**
 * Fetches a `.md` artifact's text and renders it as a formatted Markdown
 * document, replacing the raw-source iframe view. Relative image/link
 * references inside the document resolve against the session's file API.
 */
export function ArtifactMarkdownContent({
  sessionId,
  url,
}: ArtifactMarkdownContentProps) {
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
          title="Couldn't load this document"
          description="The Markdown file could not be fetched. Try opening it in a new tab."
        />
      </BlockStack>
    );
  }

  return (
    <ScrollRegion>
      <Box background="base" padding="lg" maxInlineSize="2xl">
        <Markdown artifactBaseUrl={apiUrl(`/api/sessions/${sessionId}/files`)}>
          {data}
        </Markdown>
      </Box>
    </ScrollRegion>
  );
}
