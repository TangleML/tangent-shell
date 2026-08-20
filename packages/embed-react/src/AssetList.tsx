import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import type { EmbedAsset, TangentAssetListElementLike } from "./types";

export interface AssetListProps {
  /** The session whose assets to render. */
  sessionId: string;
  /** Highlighted row (artifact URL or trigger id). */
  selectedId?: string;
  /** A card was clicked; the host decides what opening an asset means. */
  onOpen: (asset: EmbedAsset) => void;
  /** An artifact was unpinned; the host can close a matching viewer. */
  onUnpin?: (path: string) => void;
  /** Disambiguates the provider when a page mounts more than one. */
  instance?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders the embedded asset list as `<tangent-asset-list>`. Wire `onOpen` to
 * place an `<ArtifactViewer>` for a `page`; unpin surfaces via `onUnpin`.
 */
export function AssetList({
  sessionId,
  selectedId,
  onOpen,
  onUnpin,
  instance,
  className,
  style,
}: AssetListProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current as TangentAssetListElementLike | null;
    if (element) element.sessionId = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const element = ref.current as TangentAssetListElementLike | null;
    if (element && selectedId != null) element.selectedId = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handleOpen = (event: Event) => {
      onOpen((event as CustomEvent<EmbedAsset>).detail);
    };
    const handleUnpin = (event: Event) => {
      onUnpin?.((event as CustomEvent<{ path: string }>).detail.path);
    };
    element.addEventListener("open-asset", handleOpen);
    element.addEventListener("unpin-asset", handleUnpin);
    return () => {
      element.removeEventListener("open-asset", handleOpen);
      element.removeEventListener("unpin-asset", handleUnpin);
    };
  }, [onOpen, onUnpin]);

  return (
    <tangent-asset-list
      ref={ref}
      instance={instance}
      className={className}
      style={{ height: "100%", ...style }}
    />
  );
}
