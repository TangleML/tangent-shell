# @tangent/ui-extensions-sdk

The authoring SDK for **Tangle UI extensions** — the small React components a
bundle renders inside the chat (a `message` chip/card) or the composer (a
`panel` form). It is the single source of truth for the extension contract:

- the **typed component vocabulary** (`Button`, `Card`, `Text`, …),
- the **`host` bridge** (the only channel a sandboxed component has to the app),
- the **wire contracts** (zod schemas) shared by the host and worker runtimes,
- the **`ui-extensions` CLI** for building and type-checking a bundle locally,
- the **esbuild build helper** the server also uses on upload (no drift).

If you are writing an extension, you only need [Authoring](#authoring-an-extension)
and [The CLI](#the-cli). The rest documents how the package is wired for
maintainers.

---

## How an extension runs (the mental model)

1. You write a `.tsx` component under your bundle's `ui/` directory and import
   from `@tangent/ui-extensions-sdk`.
2. On upload, the server transpile-bundles each entry to ESM (via the shared
   [`buildUiComponent`](#build-helper-tangentui-extensions-sdkbuild) helper),
   leaving bare imports (`react`, `@tangent/ui-extensions-sdk`) external.
3. In the browser, the component runs inside a **Web Worker** sandbox. The worker
   injects its own React and a live implementation of the SDK, then streams the
   rendered tree to the host via [remote-dom](https://github.com/Shopify/remote-dom).
4. The component never touches the DOM, `window`, or the network directly — all
   side effects go through the `host` bridge, which the host mediates (props,
   prompts, allowlisted `fetch`, persisted state, UI commands).

Because the worker swaps the SDK module at runtime, the component
_implementations_ exported from this package are thin stubs: **only the types
matter to authors.** This is what makes local type-checking match production.

---

## Authoring an extension

A component is a default-exported React component. Import the vocabulary and the
`host` bridge from the package:

```tsx
import {
  Card,
  BlockStack,
  Text,
  Progress,
  host,
} from "@tangent/ui-extensions-sdk";
import { useEffect, useState } from "react";

export default function PipelineProgress() {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    host.getProps().then((props) => {
      if (typeof props.percent === "number") setPct(props.percent);
    });
  }, []);

  return (
    <Card density="compact">
      <BlockStack gap="2">
        <Text size="sm">Pipeline progress</Text>
        <Progress value={pct} tone={pct >= 1 ? "success" : "info"} />
      </BlockStack>
    </Card>
  );
}
```

### The two kinds

Declare each component in your bundle's `tangent.yaml`:

```yaml
ui:
  components:
    - name: pipeline-progress
      kind: message # or "panel"
      entry: ui/pipeline-progress.tsx
```

| Kind      | Rendered when                               | Gets props from              |
| --------- | ------------------------------------------- | ---------------------------- |
| `message` | the agent emits a `tangent-ui:<name>` block | `host.getProps()` (its JSON) |
| `panel`   | listed in the composer for the bundle       | none (`getProps()` is empty) |

### The component vocabulary

Every component is fully typed — props, enums, and event handlers autocomplete.

`Badge`, `BlockStack`, `Button`, `Card`, `CardHeader`, `CardTitle`,
`CardDescription`, `CardContent`, `CardFooter`, `Checkbox`, `Heading`, `Icon`,
`InlineStack`, `Pill`, `Progress`, `ScoreRing`, `Spinner`, `StatusBar`, `Text`,
`Textarea`.

Events are surfaced as plain, serializable callbacks:

- `Button` → `onPress?: () => void`
- `Checkbox` → `onCheckedChange?: (checked: boolean) => void`
- `Textarea` → `onInput?: (value: string) => void`

`Icon` `name` is typed to the Lucide icon set. Container components accept
`children`.

### The `host` bridge

`host` is the only way out of the sandbox. Every method is async.

```ts
await host.getProps(); // JSON props for a `message` component ({} for panels)
await host.sendPrompt("Launch experiment: …"); // send a chat message to Prime
await host.fetch({ target: "tangle", path: "/api/…" }); // allowlisted egress
await host.fetch("https://api.example.com/…", { method: "POST", body: {…} });
await host.getState("key"); // per-instance persisted value (message only)
await host.setState("key", value);
await host.execUICommand({ type: "collapse" }); // collapse the host message
await host.execUICommand({ type: "openTab", tab: "pipeline-editor" }); // open a full-screen in-app tab
```

`openTab` asks the host to open one of its built-in full-screen tabs. Today the
only tab is `"pipeline-editor"` — a native surface that embeds the Tangle
pipeline editor and lets Prime drive it live over CSOM. The sandbox itself
cannot render an iframe or open a socket, so a component uses this command to
hand off to the app instead.

`host.fetch` is proxied through the server's egress allowlist; direct/global
`fetch` is not available. See `docs/bundle-ui/` for the full host-bridge and
security reference.

### Multi-file extensions (helpers)

Relative imports are bundled into the entry, so you can split logic into sibling
files and import them with normal relative paths:

```
ui/
  pipeline-progress.tsx   # the entry declared in tangent.yaml
  lib/tangle-api.ts       # import { getRun } from "./lib/tangle-api"
  lib/format.ts
```

Only the worker-provided bare imports (`react`, `react/jsx-runtime`,
`@tangent/ui-extensions-sdk`) stay external. **Other npm packages are not
available in the sandbox** — anything bare other than those will fail to resolve
at runtime.

---

## The CLI

The package ships a `ui-extensions` binary. `<dir>` defaults to the current
directory and must contain a `tangent.yaml`.

```bash
ui-extensions init [dir]        # scaffold a tsconfig.json for authoring
ui-extensions typecheck [dir]   # tsc --noEmit over the bundle's ui/ sources
ui-extensions build [dir]       # compile every ui.components entry to ui-dist/
```

### Typical workflow (external bundle repo)

```bash
# 1. Install the SDK + React types as dev dependencies
pnpm add -D @tangent/ui-extensions-sdk react @types/react

# 2. Scaffold tsconfig.json (extends the SDK's author preset)
pnpm exec ui-extensions init

# 3. Author under ui/, then type-check and build
pnpm exec ui-extensions typecheck
pnpm exec ui-extensions build
```

`build` writes compiled ESM to `ui-dist/<name>.js`, mirroring what the server
produces on upload (bare imports left external). Add `ui-dist/` to your
`.gitignore` — it is generated output.

### Running the CLI in this monorepo

The in-repo example lives at `examples/tangle-oss` (it has a checked-in
`tsconfig.json` with in-repo path aliases). Run the CLI against it with:

```bash
pnpm --filter @tangent/ui-extensions-sdk cli build ../../examples/tangle-oss
pnpm --filter @tangent/ui-extensions-sdk cli typecheck ../../examples/tangle-oss
# or invoke the linked bin from a consumer package:
pnpm --filter @tangent/web exec ui-extensions build ../../examples/tangle-oss
```

---

## Package exports

| Subpath                                           | Purpose                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `@tangent/ui-extensions-sdk`                      | Author entry: typed components + `host` + bridge types.             |
| `@tangent/ui-extensions-sdk/types`                | The host/worker bridge types on their own.                          |
| `@tangent/ui-extensions-sdk/contracts/<x>`        | A single component's wire contract (`attributes`, `events`, `TAG`). |
| `@tangent/ui-extensions-sdk/build`                | The shared esbuild helper (`buildUiComponent`).                     |
| `@tangent/ui-extensions-sdk/tsconfig.author.json` | The tsconfig preset authors extend.                                 |

### Build helper (`@tangent/ui-extensions-sdk/build`)

The server and the CLI import the **same** function so a component that builds
locally builds identically on upload:

```ts
import {
  buildUiComponent,
  uiComponentBuildOptions,
} from "@tangent/ui-extensions-sdk/build";

const esmSource = await buildUiComponent("/abs/path/to/ui/entry.tsx");
```

The esbuild config is transpile-bundle only (`bundle: true`, `format: "esm"`,
`platform: "browser"`, `jsx: "automatic"`, `packages: "external"`) with an
explicit `external` list for the worker-provided specifiers. That explicit list
matters: without it, esbuild would inline a workspace-symlinked
`@tangent/ui-extensions-sdk` (its symlink resolves outside `node_modules`),
diverging from the server build and shadowing the real runtime.

### The tsconfig preset

`tsconfig.author.json` is self-contained (`jsx: react-jsx`,
`moduleResolution: bundler`, `lib: DOM/ES2022`, `strict`) so external authors
extend it without needing any other `@tangent/*` package:

```json
{
  "extends": "@tangent/ui-extensions-sdk/tsconfig.author.json",
  "include": ["ui/**/*.tsx"]
}
```

`ui-extensions init` writes exactly this.

---

## Package layout

```
src/
  index.ts            # author entry — re-exports components, host, types
  components.ts       # typed component decls + prop types (derived from contracts)
  host.ts             # the typed `host` bridge object
  types.ts            # host/worker bridge contract types
  build.ts            # shared esbuild options + buildUiComponent()
  cli.ts              # the `ui-extensions` binary
  contracts/
    <component>.ts     # per-component zod attributes + events + TAG (pure zod)
    events.ts          # RemoteEvents / EventPayload types
    enums.ts           # cross-component enum tuples (GAP, TEXT_SIZE, …)
tsconfig.author.json  # the preset authors extend
```

### How the pieces connect

- **`contracts/*`** are pure zod schemas — the wire truth. They are consumed by
  the web app's worker (to define remote elements) and host (to validate
  attributes) via the `contracts/<x>` subpath.
- **`components.ts`** derives each `…Props` type from `z.infer<typeof attributes>`
  and adds event handlers + `children`, then exports thin stub components. The
  web runtime (`apps/web/.../runtime/bridge.tsx`) provides the real
  implementations at worker time; production never runs these stubs.
- **`types.ts`** is the bridge contract shared by the SDK, the web host, and the
  worker so the halves cannot drift.

---

## Adding a new component (maintainers)

1. Add `src/contracts/<name>.ts` — export `TAG`, a zod `attributes` object, and
   `events` (`RemoteEvents`). Reuse enum tuples from `contracts/enums.ts` where
   they apply.
2. Add the prop type + stub export in `src/components.ts` (derive from
   `z.infer<typeof attributes>`; add event handlers / `children` as needed).
3. In `apps/web/src/features/bundle-ui/components/<name>/`:
   - `<name>.remote.tsx` — `makeAuthorComponent` over `defineRemoteElement`,
     re-exported from `runtime/bridge.tsx`.
   - `<name>.host.tsx` — the host adapter mapping to the real
     `@tangent/ui-primitives` component; register it in
     `components/host-registry.ts`.
4. Run the checks below and update `docs/bundle-ui/element-vocabulary.md`.

---

## Development & validation

This package has no build step — it is consumed as TypeScript source through its
`exports` map (like the other `@tangent/*` workspace packages).

```bash
pnpm --filter @tangent/ui-extensions-sdk typecheck
pnpm --filter @tangent/ui-extensions-sdk lint
pnpm --filter @tangent/ui-extensions-sdk format

# repo-wide (typecheck + lint + build across all packages)
pnpm validate

# the server tests exercise the upload → compile path end-to-end
pnpm --filter @tangent/server test
```

## Notes & non-goals

- The sandbox model is fixed: npm packages other than the worker-provided ones
  are unsupported; all egress goes through the server allowlist.
- Bundles compiled before the SDK rename import the legacy `@tangent/bundle-ui`
  specifier; the worker registers it as an alias to the same runtime, so old and
  new artifacts both resolve. New builds emit `@tangent/ui-extensions-sdk`.
