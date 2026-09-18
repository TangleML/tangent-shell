import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  BUNDLE_DIRS,
  type BundleManifest,
  MANIFEST_FILENAME,
} from "@tangent/shared/configBundle.ts";
import type { AgentBundleMeta } from "@tangent/shared/contracts.ts";
import {
  buildUiComponent,
  UiComponentBuildError,
} from "@tangent/ui-extensions-sdk/build";
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

/** A bundle's extracted contents, keyed by bundle-relative POSIX path. */
type BundleEntries = Record<string, Uint8Array>;

/**
 * Unzips a bundle, validates its manifest, and returns the parsed manifest, the
 * optional preview icon, and the full set of extracted entries (so the caller
 * can compile declared UI sources without re-unzipping). Throws {@link
 * AgentBundleValidationError} when the manifest is missing, invalid, or carries
 * an unsafe id.
 */
function parseBundle(zipBuffer: Buffer): {
  manifest: BundleManifest;
  iconData: Uint8Array | undefined;
  entries: BundleEntries;
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

  return {
    manifest,
    iconData: manifest.icon ? entries[manifest.icon] : undefined,
    entries,
  };
}

/** A single declared UI component entry from a bundle manifest. */
type UiComponent = NonNullable<BundleManifest["ui"]>["components"][number];

/** Throws when any declared UI entry is absent from the extracted zip. */
function assertUiEntriesPresent(
  components: readonly UiComponent[],
  entries: BundleEntries,
): void {
  for (const component of components) {
    if (entries[component.entry]) continue;
    throw new AgentBundleValidationError(
      `agent bundle: ui entry "${component.entry}" not found`,
    );
  }
}

/** Writes every extracted entry into `work` so esbuild can resolve siblings. */
async function materializeEntries(
  work: string,
  entries: BundleEntries,
): Promise<void> {
  for (const [name, data] of Object.entries(entries)) {
    const dest = path.join(work, name);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, data);
  }
}

/**
 * Transpile-bundles a single component and writes `<outDir>/<name>.js`. Throws
 * {@link AgentBundleValidationError} when the entry fails to compile.
 */
async function compileComponent(
  work: string,
  outDir: string,
  component: UiComponent,
): Promise<void> {
  let output: string;
  try {
    output = await buildUiComponent(path.join(work, component.entry));
  } catch (err) {
    const detail =
      err instanceof UiComponentBuildError && err.cause instanceof Error
        ? err.cause.message
        : err instanceof Error
          ? err.message
          : String(err);
    throw new AgentBundleValidationError(
      `agent bundle: failed to compile ui entry "${component.entry}"\n${detail}`,
    );
  }
  await writeFile(path.join(outDir, `${component.name}.js`), output);
}

/**
 * Transpiles each declared UI component to ESM under `<dir>/ui/<name>.js`.
 *
 * The component sources are extracted to a temp working directory so esbuild
 * can resolve relative sibling imports, then bundled transpile-only via the
 * shared {@link buildUiComponent} helper (also used by the `ui-extensions` CLI,
 * so local builds match): bare imports such as `react` and
 * `@tangent/ui-extensions-sdk` are left untouched for the worker import map to
 * resolve, while relative imports within the bundle are inlined. The component
 * never executes here. Throws {@link AgentBundleValidationError} when a declared
 * entry is missing from the zip or fails to compile, so the upload route can
 * answer `400`.
 */
async function compileUiComponents(
  dir: string,
  manifest: BundleManifest,
  entries: BundleEntries,
): Promise<void> {
  const components = manifest.ui?.components;
  if (!components || components.length === 0) return;

  assertUiEntriesPresent(components, entries);

  const work = await mkdtemp(path.join(os.tmpdir(), "tangent-ui-"));
  try {
    await materializeEntries(work, entries);

    const outDir = path.join(dir, BUNDLE_DIRS.ui);
    await mkdir(outDir, { recursive: true });

    for (const component of components) {
      await compileComponent(work, outDir, component);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Projects the manifest's declared UI components down to the {@link
 * AgentBundleMeta} summary (`name`, `kind`, `title`) so the marketplace can list
 * a bundle's UI without unzipping it. Returns `undefined` when the bundle ships
 * no UI.
 */
function toComponentMetas(
  manifest: BundleManifest,
): AgentBundleMeta["components"] {
  return manifest.ui?.components.map(({ name, kind, title }) => ({
    name,
    kind,
    title,
  }));
}

/**
 * Builds the {@link AgentBundleMeta} record persisted alongside a saved bundle,
 * preserving the original `createdAt` when replacing an existing version.
 */
function buildMeta(
  manifest: BundleManifest,
  iconData: Uint8Array | undefined,
  existing: AgentBundleMeta | undefined,
  now: string,
): AgentBundleMeta {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    tags: manifest.tags,
    hasIcon: Boolean(iconData),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    components: toComponentMetas(manifest),
  };
}

/**
 * Filesystem-backed {@link AgentBundleStore}. Each saved bundle lives under
 * `AGENT_BUNDLES_ROOT/<id>/` as the original `bundle.zip`, an extracted
 * `manifest.json` (the {@link AgentBundleMeta} used for fast listing), and an
 * optional `icon.svg`.
 */
export class FileAgentBundleStore implements AgentBundleStore {
  private readonly root: string;

  constructor(root: string = AGENT_BUNDLES_ROOT) {
    this.root = root;
  }

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
      const raw = await readFile(
        path.join(this.dir(id), META_FILENAME),
        "utf8",
      );
      return JSON.parse(raw) as AgentBundleMeta;
    } catch {
      return undefined;
    }
  }

  async save(zipBuffer: Buffer): Promise<AgentBundleMeta> {
    const { manifest, iconData, entries } = parseBundle(zipBuffer);

    const existing = await this.get(manifest.id);
    if (existing && existing.version === manifest.version) {
      throw new AgentBundleConflictError(
        `agent bundle "${manifest.id}" version ${manifest.version} already exists`,
      );
    }

    const now = new Date().toISOString();
    const meta = buildMeta(manifest, iconData, existing, now);

    const dir = this.dir(manifest.id);
    // Replace any prior version's files wholesale so a stale icon (or stale
    // compiled UI component) can't linger.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(path.join(dir, BUNDLE_FILENAME), zipBuffer);
      // Compile before persisting metadata so a bad UI source fails the upload
      // without leaving a half-installed bundle behind.
      await compileUiComponents(dir, manifest, entries);
      await writeFile(
        path.join(dir, META_FILENAME),
        JSON.stringify(meta, null, 2),
      );
      if (iconData) {
        await writeFile(path.join(dir, ICON_FILENAME), iconData);
      }
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
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

  async readUiComponent(id: string, name: string): Promise<string | undefined> {
    // `name` becomes a filename, so reject anything that isn't a plain slug.
    if (isUnsafeId(id) || !/^[a-z0-9][a-z0-9-]*$/.test(name)) return undefined;
    try {
      return await readFile(
        path.join(this.dir(id), BUNDLE_DIRS.ui, `${name}.js`),
        "utf8",
      );
    } catch {
      return undefined;
    }
  }
}
