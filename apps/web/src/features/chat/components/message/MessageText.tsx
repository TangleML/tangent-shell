import { Paragraph } from "@tangent/ui-primitives/typography";

import { splitReferenceLinks } from "@/features/chat/model/references";
import { apiUrl } from "@/shared/lib/basePath";
import { HostOwnedSurface } from "@/shared/lib/HostOwnedSurface";
import { useHostExtensions } from "@/shared/lib/hostSlots";
import {
  isAbsoluteUrl,
  isViewableArtifact,
  protocolOf,
  resolveUrl,
} from "@/shared/lib/markdown/artifact";
import { ArtifactChip } from "@/shared/lib/markdown/ArtifactChip";

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
 * chip.
 */
export function MessageText({
  content,
  sessionId,
  messageId,
  tone,
  onOpenArtifact,
}: MessageTextProps) {
  const { registry, anchorProtocols } = useHostExtensions();

  function hostProtocolOf(href: string): string | undefined {
    const protocol = protocolOf(href);
    return registry && protocol && anchorProtocols.has(protocol)
      ? protocol
      : undefined;
  }

  const segments = splitReferenceLinks(
    content,
    (href) => hostProtocolOf(href) !== undefined || !isAbsoluteUrl(href),
  );

  return (
    <Paragraph size="sm" wrap="pre-wrap" tone={tone}>
      {segments.map((segment) => {
        if (segment.kind === "text") return segment.text;

        const { href, label, offset } = segment;
        const protocol = hostProtocolOf(href);
        if (protocol) {
          return (
            <HostOwnedSurface
              key={offset}
              id={`anchor:${messageId}:${offset}`}
              surface="anchor"
              slotKey={protocol}
              props={{
                href,
                protocol,
                path: href.slice(protocol.length + "://".length),
                label,
              }}
            />
          );
        }

        const url =
          resolveUrl(href, apiUrl(`/api/sessions/${sessionId}/files`)) ?? href;
        return (
          <ArtifactChip
            key={offset}
            href={url}
            onOpen={
              onOpenArtifact && isViewableArtifact(href)
                ? () => onOpenArtifact(url, label)
                : undefined
            }
          >
            {label}
          </ArtifactChip>
        );
      })}
    </Paragraph>
  );
}
