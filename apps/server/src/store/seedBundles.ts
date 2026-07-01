import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { AgentBundleStore } from "./agentBundleStore.ts";

// Set by the `pnpm seed` script (to "$PWD/examples").
function exampleBundlesDir(): string {
  const dir = process.env.SEED_BUNDLES_DIR;
  if (!dir) throw new Error("SEED_BUNDLES_DIR is not set; run via `pnpm seed`");
  return dir;
}

/** Installs example bundles into an empty marketplace; no-op otherwise. Returns the count installed. */
export async function seedExampleBundles(
  store: AgentBundleStore,
): Promise<number> {
  if ((await store.list()).length > 0) {
    console.log("[seed] marketplace already populated; nothing to do");
    return 0;
  }

  const dir = exampleBundlesDir();
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".zip")).sort();
  } catch {
    console.warn(`[seed] no example bundles directory at ${dir}; skipping`);
    return 0;
  }

  let installed = 0;
  for (const name of names) {
    try {
      const zip = await readFile(path.join(dir, name));
      const bundle = await store.save(zip);
      installed += 1;
      console.log(`[seed] installed ${bundle.id}@${bundle.version}`);
    } catch (err) {
      // Skip a bad/duplicate ZIP rather than aborting the rest.
      console.warn(`[seed] skipped ${name}: ${(err as Error).message}`);
    }
  }

  return installed;
}
