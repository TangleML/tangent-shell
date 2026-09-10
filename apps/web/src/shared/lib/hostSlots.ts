/**
 * Host-slot plumbing for the embed runtime. A host app (via `@tangent/embed-react`)
 * can register its own React components for named UI extensions and markdown
 * anchor protocols. Those components live in the host's React tree, so Tangent's
 * React (inside each custom element's shadow DOM) cannot render them directly.
 *
 * Instead, a {@link HostOwnedSurface} rendered in Tangent's tree records a slot
 * request here and renders a `<slot name={id}>`; the npm wrapper reads the
 * registry off the element and projects the matching host component as a
 * light-DOM child (`slot={id}`). The first-party app never populates this — the
 * context defaults leave every host branch inert.
 */
import { createContext, useContext } from "react";

/** Which host map a slot resolves against. */
export type HostSlotSurface = "ui" | "anchor";

/** A single host-owned slot request projected into the shadow tree. */
export interface HostSlotRecord {
  /** Stable per-occurrence id; also the `<slot>`/`slot=` name. */
  id: string;
  surface: HostSlotSurface;
  /** Component name (`ui`) or protocol scheme (`anchor`) to look up. */
  key: string;
  /** The full props object to spread onto the resolved host component. */
  props: Record<string, unknown>;
}

/** Per-`<tangent-chat>` store of active host-slot requests. */
export interface HostSlotRegistry {
  /** Adds or updates a slot record (keyed by `id`) and notifies listeners. */
  set(record: HostSlotRecord): void;
  /** Removes a slot record by id and notifies listeners. */
  remove(id: string): void;
  /** Current slot records. */
  getSlots(): HostSlotRecord[];
  /** Subscribes to changes; returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** Creates an independent host-slot registry for one chat element. */
export function createHostSlotRegistry(): HostSlotRegistry {
  const slots = new Map<string, HostSlotRecord>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    set(record) {
      slots.set(record.id, record);
      notify();
    },
    remove(id) {
      if (slots.delete(id)) notify();
    },
    getSlots() {
      return [...slots.values()];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The host extensions available to Tangent's React tree, per provider. */
export interface HostExtensions {
  /** Where host components register slot requests, or null (first-party). */
  registry: HostSlotRegistry | null;
  /** Names that render a host UI component instead of a sandboxed one. */
  uiNames: ReadonlySet<string>;
  /** Anchor protocols that render a host component instead of a link. */
  anchorProtocols: ReadonlySet<string>;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export const EMPTY_HOST_EXTENSIONS: HostExtensions = {
  registry: null,
  uiNames: EMPTY_SET,
  anchorProtocols: EMPTY_SET,
};

export const HostExtensionsContext = createContext<HostExtensions>(
  EMPTY_HOST_EXTENSIONS,
);

export function useHostExtensions(): HostExtensions {
  return useContext(HostExtensionsContext);
}
