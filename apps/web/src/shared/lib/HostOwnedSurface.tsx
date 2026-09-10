import { useEffect } from "react";

import {
  type HostSlotSurface,
  useHostExtensions,
} from "@/shared/lib/hostSlots";

interface HostOwnedSurfaceProps {
  /** Stable per-occurrence id; also the projected `<slot>` name. */
  id: string;
  surface: HostSlotSurface;
  /** Component name (`ui`) or protocol scheme (`anchor`). */
  slotKey: string;
  /** Props spread onto the host component by the npm wrapper. */
  props: Record<string, unknown>;
}

/**
 * Requests a host-owned component be projected at this position. Registers the
 * slot with the chat's registry and renders a `<slot>` the wrapper fills with a
 * light-DOM child. Renders nothing when no registry is present (first-party).
 */
export function HostOwnedSurface({
  id,
  surface,
  slotKey,
  props,
}: HostOwnedSurfaceProps) {
  const { registry } = useHostExtensions();

  useEffect(() => {
    registry?.set({ id, surface, key: slotKey, props });
  });

  useEffect(() => {
    return () => registry?.remove(id);
  }, [registry, id]);

  if (!registry) return null;
  return <slot name={id} />;
}
