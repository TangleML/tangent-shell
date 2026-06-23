import { AGENT_BUNDLES_ROOT } from "./config.ts";
import { FileAgentBundleStore } from "./store/fileAgentBundleStore.ts";
import { seedExampleBundles } from "./store/seedBundles.ts";

// CLI entry for `pnpm seed`. Run manually; not wired into dev/build.
async function main(): Promise<void> {
  const store = new FileAgentBundleStore();
  const installed = await seedExampleBundles(store);
  console.log(
    `[seed] installed ${installed} bundle(s) into ${AGENT_BUNDLES_ROOT}`,
  );
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  },
);
