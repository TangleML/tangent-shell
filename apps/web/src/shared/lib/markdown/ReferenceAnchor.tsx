import type { ReactNode } from "react";

import { HostOwnedSurface } from "@/shared/lib/HostOwnedSurface";
import { useHostAnchorProtocol } from "@/shared/lib/hostSlots";
import {
  isSessionFilePath,
  isViewableArtifact,
  resolveUrl,
} from "@/shared/lib/markdown/artifact";

import { ArtifactChip } from "./ArtifactChip";

interface ReferenceAnchorProps {
  href: string;
  children: ReactNode;
  /** With `offset`, keys the host's chip for this link within its message. */
  messageId: string;
  offset: number;
  /** Where the session's files are served; without it a file link is no chip. */
  artifactBaseUrl?: string;
  title?: string;
  onOpenArtifact?: (url: string, title: string) => void;
  pinned?: boolean;
  /** Adds a pin toggle to a file's chip; it's given the chip's label. */
  onTogglePin?: (label: string) => void;
  /** Shown when the link is neither a host target nor a session file. */
  fallback?: ReactNode;
}

/** Flattens a link's markdown children into a plain-text label. */
function anchorText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(anchorText).join("");
  return "";
}

/** Derives a short tab title from the link text, falling back to the filename. */
function artifactLabel(children: ReactNode, url: string): string {
  if (typeof children === "string" && children.trim()) return children.trim();
  const path = url.split(/[?#]/, 1)[0];
  const filename = path.split("/").pop() ?? url;
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

/**
 * A link the chat shows as a chip: a host target as the host's own chip, a
 * session file as an artifact chip, opened in a tab when a browser can show it.
 */
export function ReferenceAnchor({
  href,
  children,
  messageId,
  offset,
  artifactBaseUrl,
  title,
  onOpenArtifact,
  pinned,
  onTogglePin,
  fallback = null,
}: ReferenceAnchorProps) {
  const hostProtocolOf = useHostAnchorProtocol();
  const protocol = hostProtocolOf(href);

  if (protocol) {
    return (
      <HostOwnedSurface
        id={`anchor:${messageId}:${offset}`}
        surface="anchor"
        slotKey={protocol}
        props={{
          href,
          protocol,
          path: href.slice(protocol.length + "://".length),
          label: anchorText(children),
        }}
      />
    );
  }

  if (artifactBaseUrl == null || !isSessionFilePath(href)) return fallback;

  const url = resolveUrl(href, artifactBaseUrl) ?? href;
  const label = artifactLabel(children, url);
  return (
    <ArtifactChip
      href={url}
      title={title}
      onOpen={
        onOpenArtifact && isViewableArtifact(href)
          ? () => onOpenArtifact(url, label)
          : undefined
      }
      pinned={pinned}
      onTogglePin={onTogglePin ? () => onTogglePin(label) : undefined}
    >
      {children}
    </ArtifactChip>
  );
}
