import type { PinnedArtifact } from "@tangent/shared/contracts.ts";

import type { ResourceStore } from "./resourceStore.ts";

/**
 * Mirrors a pin into the resource catalog. A link never takes over a uri that
 * another kind (e.g. a host resource) already holds, since the catalog is
 * unique on uri.
 */
export async function catalogPin(
  resources: ResourceStore | undefined,
  sessionId: string,
  pin: { kind: PinnedArtifact["kind"]; target: string; title: string },
): Promise<void> {
  if (!resources) return;
  const input = {
    sessionId,
    kind: pin.kind,
    name: pin.title,
    uri: pin.target,
  };
  if (pin.kind !== "link") {
    await resources.catalog(input);
    return;
  }
  const stored = await resources.catalogIfAbsent(input);
  if (stored.kind === "link" && stored.name !== pin.title) {
    await resources.catalog(input);
  }
}

/** Drops a pin's catalog entry, leaving a row of another kind at that uri. */
export async function uncatalogPin(
  resources: ResourceStore | undefined,
  sessionId: string,
  pin: { kind: PinnedArtifact["kind"]; target: string },
): Promise<void> {
  await resources?.remove(sessionId, pin.target, pin.kind);
}
