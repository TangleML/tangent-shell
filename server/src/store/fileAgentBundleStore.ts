import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  type BundleManifest,
  MANIFEST_FILENAME,
} from "@shared/configBundle.ts";
import type { AgentBundleMeta } from "@shared/contracts.ts";
import { unzipSync } from "fflate";

import { AGENT_BUNDLES_ROOT } from "../config.ts";
import { parseManifest } from "../pi/config/manifest.ts";
import {
  AgentBundleConflictError,
  type AgentBundleStore,
  AgentBundleValidationError,
} from "./agentBundleStore.ts";

/** File names stored inside each bundle's `<root>/<id>` directory. */
const BUNDLE_FILENAME = "bundle.zip";
const META_FILENAME = "manifest.json";
const ICON_FILENAME = "icon.svg";

const decoder = new TextDecoder();

/** Rejects ids that aren't a single, traversal-free path segment. */
function isUnsafeId(id: string): boolean {
  return (
    id.length === 0 ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("..")
  );
}

/**
 * Unzips a bundle, validates its manifest, and returns the parsed manifest plus
 * the optional preview icon. Throws {@link AgentBundleValidationError} when the
 * manifest is missing, invalid, or carries an unsafe id.
 */
function parseBundle(zipBuffer: Buffer): {
  manifest: BundleManifest;
  iconData: Uint8Array | undefined;
} {
  const entries = unzipSync(new Uint8Array(zipBuffer));

  const manifestEntry = entries[MANIFEST_FILENAME];
  if (!manifestEntry) {
    throw new AgentBundleValidationError(
      `agent bundle: missing ${MANIFEST_FILENAME}`,
    );
  }

  const parsed = parseManifest(decoder.decode(manifestEntry));
  if ("errors" in parsed) {
    throw new AgentBundleValidationError(
      `agent bundle: invalid manifest\n${parsed.errors.join("\n")}`,
    );
  }
  const manifest = parsed.manifest;

  // `id` comes from the (slug-validated) manifest, but guard anyway since it
  // becomes a directory name.
  if (isUnsafeId(manifest.id)) {
    throw new AgentBundleValidationError(
      `agent bundle: unsafe id "${manifest.id}"`,
    );
  }

  return { manifest, iconData: entries[manifest.icon] };
}

/**
 * Filesystem-backed {@link AgentBundleStore}. Each saved bundle lives under
 * `AGENT_BUNDLES_ROOT/<id>/` as the original `bundle.zip`, an extracted
 * `manifest.json` (the {@link AgentBundleMeta} used for fast listing), and an
 * optional `icon.svg`.
 */
export class FileAgentBundleStore implements AgentBundleStore {
  constructor(private readonly root: string = AGENT_BUNDLES_ROOT) {}

  /** Absolute path to a bundle's storage directory. */
  private dir(id: string): string {
    return path.join(this.root, id);
  }

  async list(): Promise<AgentBundleMeta[]> {
    let ids: string[];
    try {
      ids = await readdir(this.root);
    } catch {
      // Root not created yet: nothing has been saved.
      return [];
    }

    const metas: AgentBundleMeta[] = [];
    for (const id of ids) {
      const meta = await this.get(id);
      if (meta) metas.push(meta);
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<AgentBundleMeta | undefined> {
    if (isUnsafeId(id)) return undefined;
    try {
      const raw = await readFile(path.join(this.dir(id), META_FILENAME), "utf8");
      return JSON.parse(raw) as AgentBundleMeta;
    } catch {
      return undefined;
    }
  }

  async save(zipBuffer: Buffer): Promise<AgentBundleMeta> {
    const { manifest, iconData } = parseBundle(zipBuffer);

    const existing = await this.get(manifest.id);
    if (existing && existing.version === manifest.version) {
      throw new AgentBundleConflictError(
        `agent bundle "${manifest.id}" version ${manifest.version} already exists`,
      );
    }

    const now = new Date().toISOString();
    const meta: AgentBundleMeta = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      tags: manifest.tags,
      hasIcon: Boolean(iconData),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const dir = this.dir(manifest.id);
    // Replace any prior version's files wholesale so a stale icon can't linger.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, BUNDLE_FILENAME), zipBuffer);
    await writeFile(
      path.join(dir, META_FILENAME),
      JSON.stringify(meta, null, 2),
    );
    if (iconData) {
      await writeFile(path.join(dir, ICON_FILENAME), iconData);
    }

    return meta;
  }

  async delete(id: string): Promise<boolean> {
    if (isUnsafeId(id)) return false;
    if (!(await this.get(id))) return false;
    await rm(this.dir(id), { recursive: true, force: true });
    return true;
  }

  async readBundle(id: string): Promise<Buffer | undefined> {
    if (isUnsafeId(id)) return undefined;
    try {
      return await readFile(path.join(this.dir(id), BUNDLE_FILENAME));
    } catch {
      return undefined;
    }
  }

  async readIcon(id: string): Promise<Buffer | undefined> {
    if (isUnsafeId(id)) return undefined;
    try {
      return await readFile(path.join(this.dir(id), ICON_FILENAME));
    } catch {
      return undefined;
    }
  }
}
