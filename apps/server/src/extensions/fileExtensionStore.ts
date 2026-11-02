import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { GlobalExtensionMeta } from "@tangent/shared/contracts.ts";

import { EXTENSIONS_ROOT } from "../config.ts";

/** Metadata filename stored at the root of each install's `<root>/<id>` dir. */
const META_FILENAME = "extension.json";

/** Install subdirectory holding the installed package tree. */
export const PKG_DIRNAME = "pkg";

/** Install subdirectory preserving a `file` source's original upload. */
export const SOURCE_DIRNAME = "source";

/** Rejects ids that aren't a single, traversal-free path segment. */
export function isUnsafeId(id: string): boolean {
  return (
    id.length === 0 ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("..")
  );
}

/**
 * Filesystem-backed persistence for installed global extensions, mirroring
 * {@link import("../store/fileAgentBundleStore.ts").FileAgentBundleStore}. Each
 * install lives under `EXTENSIONS_ROOT/<id>/` as `extension.json`, a `pkg/`
 * tree, and (for `file` sources) a preserved `source/` upload. Writes go to a
 * sibling staging directory and are swapped in with an atomic rename so a failed
 * install never leaves a half-written entry.
 */
export class FileExtensionStore {
  private readonly root: string;

  constructor(root: string = EXTENSIONS_ROOT) {
    this.root = root;
  }

  /** Absolute path to an install's storage directory. */
  dir(id: string): string {
    return path.join(this.root, id);
  }

  /** Absolute path to an install's package tree. */
  pkgDir(id: string): string {
    return path.join(this.dir(id), PKG_DIRNAME);
  }

  /** Absolute path to an install's preserved `file` upload directory. */
  sourceDir(id: string): string {
    return path.join(this.dir(id), SOURCE_DIRNAME);
  }

  async get(id: string): Promise<GlobalExtensionMeta | undefined> {
    if (isUnsafeId(id)) return undefined;
    try {
      const raw = await readFile(
        path.join(this.dir(id), META_FILENAME),
        "utf8",
      );
      return JSON.parse(raw) as GlobalExtensionMeta;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<GlobalExtensionMeta[]> {
    let ids: string[];
    try {
      ids = await readdir(this.root);
    } catch {
      return [];
    }
    const metas: GlobalExtensionMeta[] = [];
    for (const id of ids) {
      if (id.startsWith(".")) continue;
      const meta = await this.get(id);
      if (meta) metas.push(meta);
    }
    return metas.sort((a, b) => a.id.localeCompare(b.id));
  }

  async delete(id: string): Promise<boolean> {
    if (isUnsafeId(id)) return false;
    if (!(await this.get(id))) return false;
    await rm(this.dir(id), { recursive: true, force: true });
    return true;
  }

  /** Creates an empty staging directory (same volume) to install into. */
  async makeStaging(): Promise<string> {
    await mkdir(this.root, { recursive: true });
    return mkdtemp(path.join(this.root, ".staging-"));
  }

  /** Writes an install's `extension.json` into a directory (staging or final). */
  async writeMeta(dir: string, meta: GlobalExtensionMeta): Promise<void> {
    await writeFile(
      path.join(dir, META_FILENAME),
      JSON.stringify(meta, null, 2),
    );
  }

  /** Atomically swaps a staged install into `<root>/<id>`, replacing any prior. */
  async commit(staging: string, id: string): Promise<void> {
    const dest = this.dir(id);
    await rm(dest, { recursive: true, force: true });
    await rename(staging, dest);
  }

  /** Discards a staging directory (on a failed install). */
  async discard(staging: string): Promise<void> {
    await rm(staging, { recursive: true, force: true });
  }

  /** The first preserved upload under an install's `source/`, if any. */
  async sourceFile(id: string): Promise<string | undefined> {
    try {
      const files = await readdir(this.sourceDir(id));
      return files[0] ? path.join(this.sourceDir(id), files[0]) : undefined;
    } catch {
      return undefined;
    }
  }
}
