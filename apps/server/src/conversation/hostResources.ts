import {
  type HostResourceInput,
  MEMORY_AUTHOR,
  type MemoryScope,
} from "@tangent/shared/contracts.ts";

import type { MemoryManager } from "../pi/memory.ts";
import type { CatalogInput, Resource } from "../store/resourceStore.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { orchestratorConversationFor } from "./participantRegistry.ts";
import type { ResourceCatalog } from "./resourceCatalog.ts";

/** Everything a host-resource write needs beyond the input. */
export interface ResourceSeedDeps {
  store: SessionStore;
  memory: MemoryManager;
  catalog: ResourceCatalog;
}

/** The catalog entry a memory store stands for, keyed by its scope. */
function memoryResource(sessionId: string, scope: MemoryScope): CatalogInput {
  return {
    sessionId,
    kind: "memory",
    name: scope === "global" ? "Global memory" : "Session memory",
    uri: `memory://${scope}`,
    authorParticipantId: MEMORY_AUTHOR.id,
    meta: { scope },
  };
}

/** The catalog entry a host-provided resource stands for. */
function hostResource(
  sessionId: string,
  input: Extract<HostResourceInput, { kind: "host" }>,
  authorParticipantId: string | undefined,
): CatalogInput {
  return {
    sessionId,
    kind: "host",
    name: input.name,
    uri: input.uri,
    authorParticipantId,
    meta: input.meta,
  };
}

/** The memory scope a `memory://` uri names, or null for any other uri. */
export function memoryScopeFromUri(uri: string): MemoryScope | null {
  if (uri === "memory://session") return "session";
  if (uri === "memory://global") return "global";
  return null;
}

/**
 * Applies one host-provided resource to a session: writes the memory store (for
 * a `memory` input, so the file the agent reads is the write authority) and
 * references the entry into the orchestrator's Conversation so it surfaces.
 * Returns the catalog entry; idempotent per uri.
 */
export async function applyResourceInput(
  deps: ResourceSeedDeps,
  sessionId: string,
  rootPath: string,
  input: HostResourceInput,
  authorParticipantId?: string,
): Promise<Resource> {
  const conversationId = await orchestratorConversationFor(
    deps.store,
    sessionId,
  );
  if (input.kind === "memory") {
    const scope = input.scope ?? "session";
    deps.memory.write(rootPath, scope, input.content);
    return deps.catalog.catalogIn(
      conversationId,
      memoryResource(sessionId, scope),
    );
  }
  return deps.catalog.catalogIn(
    conversationId,
    hostResource(sessionId, input, authorParticipantId),
  );
}

/**
 * Removes a catalogued resource by uri, cascading its references. Removing a
 * memory store's entry also empties the store, so `read_memory` and the catalog
 * agree.
 */
export async function removeResourceByUri(
  deps: ResourceSeedDeps,
  sessionId: string,
  rootPath: string,
  uri: string,
): Promise<void> {
  await deps.catalog.remove(sessionId, uri);
  const scope = memoryScopeFromUri(uri);
  if (scope) deps.memory.clear(rootPath, scope);
}
