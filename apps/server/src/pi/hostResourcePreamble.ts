import type { ResourceCatalog } from "../conversation/resourceCatalog.ts";
import type { Resource } from "../store/resourceStore.ts";

/** The `description` a host resource's meta carries, when it has one. */
function description(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const value = meta.description;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Renders the `## Host resources` system-prompt block from a session's catalog,
 * or `""` when it holds no host resources. Only `host` entries appear here;
 * memory is carried by the memory preamble.
 */
export function renderHostResourcesPreamble(resources: Resource[]): string {
  const hosts = resources.filter((resource) => resource.kind === "host");
  if (hosts.length === 0) return "";

  const lines = [
    "## Host resources",
    "",
    "The host app attached the following resources as standing context. They can",
    "change during the session — call `read_resources` to re-read the current",
    "set before relying on them.",
    "",
  ];
  for (const host of hosts) {
    lines.push(`- ${host.name} (${host.uri})`);
    const desc = description(host.meta);
    if (desc) lines.push(`  ${desc}`);
  }
  return lines.join("\n");
}

/**
 * Spawn-time projection of a session's host resources. The catalog is the store;
 * this caches the rendered preamble so the synchronous spawn path can read it,
 * and is refreshed on every resource mutation.
 */
export class HostResourcePreamble {
  private readonly bySession = new Map<string, string>();
  private readonly catalog: ResourceCatalog;

  constructor(catalog: ResourceCatalog) {
    this.catalog = catalog;
  }

  /** Rebuilds a session's cached preamble from the catalog. */
  async refresh(sessionId: string): Promise<void> {
    const resources = await this.catalog.listForSession(sessionId);
    this.bySession.set(sessionId, renderHostResourcesPreamble(resources));
  }

  /** The cached preamble text (empty when none), read synchronously at spawn. */
  get(sessionId: string): string {
    return this.bySession.get(sessionId) ?? "";
  }

  /** Drops a session's cached preamble (on session delete). */
  forget(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}
