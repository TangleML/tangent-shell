import path from "node:path";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds the embed runtime: a single, self-contained ESM module that registers
// the `tangent-*` custom elements with our React 19, Tailwind output, and
// dependencies all bundled in (nothing external — there is no host runtime to
// provide React). The compiled Tailwind CSS is inlined via `?inline` and
// adopted into each element's shadow root at runtime (see src/embed/styles.ts).
export default defineConfig({
  define: {
    // No dev-only absolute API origin in the embed bundle; the base is
    // configured at runtime through <tangent-provider>.
    __API_ORIGIN__: JSON.stringify(""),
  },
  plugins: [
    babel({
      include: /packages[\\/]windows[\\/]src[\\/].+\.ts$/,
      exclude: /node_modules/,
      plugins: [
        [
          "@babel/plugin-syntax-typescript",
          { allExtensions: false, isTSX: false },
        ],
        ["@babel/plugin-proposal-decorators", { version: "2023-05" }],
      ],
    }),
    babel({ presets: [reactCompilerPreset()] }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      // Inline the bundle-UI worker (single self-contained file); the SPA build
      // keeps the default module-URL worker. The whole specifier is matched so
      // the replacement fully substitutes the relative import in `BundleUiHost`.
      {
        find: /^\.\/createBundleUiWorker$/,
        replacement: path.resolve(
          __dirname,
          "./src/features/bundle-ui/createBundleUiWorker.embed.ts",
        ),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      {
        find: /^@tangent\/ui-extensions-sdk$/,
        replacement: path.resolve(
          __dirname,
          "./src/features/bundle-ui/runtime/bridge.tsx",
        ),
      },
    ],
  },
  build: {
    outDir: "dist/embed/v1",
    emptyOutDir: true,
    // The embed bundle inlines its CSS and needs none of the SPA's public
    // assets (favicon, logo, harness); keep the served directory minimal.
    copyPublicDir: false,
    // Long-lived immutable caching is applied by nginx on the version-pinned
    // filename; a single ESM file keeps the channel URL stable.
    lib: {
      entry: path.resolve(__dirname, "./src/embed/index.ts"),
      formats: ["es"],
      fileName: () => "tangent-elements.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
