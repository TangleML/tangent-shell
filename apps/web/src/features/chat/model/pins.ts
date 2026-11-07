import type { PinnedArtifact } from "@tangent/shared/contracts";
import { normalizePinnableUrl } from "@tangent/shared/pinnableUrl";

/**
 * A pin's identity in the UI: an artifact's workspace-relative path or a link's
 * canonical URL. The two never collide, since a workspace path is relative.
 */
export function pinKey(pin: PinnedArtifact): string {
  return pin.kind === "link" ? pin.url : pin.path;
}

/** The canonical link URL a pin key names, or null for an artifact path. */
export function linkUrlOf(key: string): string | null {
  return normalizePinnableUrl(key);
}
