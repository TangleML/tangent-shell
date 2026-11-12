import { Paragraph } from "@tangent/ui-primitives/typography";

import { splitReferenceLinks } from "@/features/chat/model/references";
import { apiUrl } from "@/shared/lib/basePath";
import { useHostAnchorProtocol } from "@/shared/lib/hostSlots";
import { isArtifactsLink } from "@/shared/lib/markdown/artifact";
import { ReferenceAnchor } from "@/shared/lib/markdown/ReferenceAnchor";

interface MessageTextProps {
  content: string;
  sessionId: string;
  messageId: string;
  tone?: "on-primary";
  onOpenArtifact?: (url: string, title: string) => void;
}

/**
 * A person's message exactly as typed, except the references picked with `#`:
 * a host target shows as the host's own chip, a session file as an artifact
 * chip. Anything else in link form, such as `callbacks[0](arg)`, stays text.
 */
export function MessageText({
  content,
  sessionId,
  messageId,
  tone,
  onOpenArtifact,
}: MessageTextProps) {
  const hostProtocolOf = useHostAnchorProtocol();
  const segments = splitReferenceLinks(
    content,
    (href) => hostProtocolOf(href) !== undefined || isArtifactsLink(href),
  );

  return (
    <Paragraph size="sm" wrap="pre-wrap" tone={tone}>
      {segments.map((segment) =>
        segment.kind === "text" ? (
          segment.text
        ) : (
          <ReferenceAnchor
            key={segment.offset}
            href={segment.href}
            messageId={messageId}
            offset={segment.offset}
            artifactBaseUrl={apiUrl(`/api/sessions/${sessionId}/files`)}
            onOpenArtifact={onOpenArtifact}
          >
            {segment.label}
          </ReferenceAnchor>
        ),
      )}
    </Paragraph>
  );
}
