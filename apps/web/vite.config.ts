import path from "node:path";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Backend the dev server proxies /api and /socket.io to. Override via the
// API_TARGET env var to point the local UI at a remote agent (e.g. the Cloud
// Run proxy on http://localhost:8788) without touching client fetch/socket code.
const apiTarget = process.env.API_TARGET ?? "http://localhost:8787";

// The embed channel URL (production: an nginx-served, prebuilt bundle at
// /embed/v1/tangent-elements.js) has no equivalent on the Vite dev server, so
// hitting it 404s. In dev, answer it with a shim that imports the live source
// through Vite's transform pipeline — same elements, with HMR and no separate
// `build:embed` step. CORS is open so a cross-port harness can import it too.
function embedDevChannel(): Plugin {
  const CHANNEL = "/embed/v1/tangent-elements.js";
  return {
    name: "tangent-embed-dev-channel",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || req.url.split("?")[0] !== CHANNEL) return next();
        res.setHeader("Content-Type", "text/javascript");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end('import "/src/embed/index.ts";\n');
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // Relative asset base so the built index.html references assets as
  // "./assets/..." rather than "/assets/...". Behind the tangle pod-proxy the
  // Kubernetes apiserver rewrites same-host absolute-path URLs in HTML to its
  // own proxy path; relative URLs are left untouched and resolve against the
  // runtime-injected <base href> (see index.html).
  base: "./",
  // Exposes the proxy target to client code so dev-only absolute URLs (e.g. the
  // copyable trigger callback URL) point at API_TARGET rather than the Vite
  // origin. Empty in production builds, where the serving backend is the origin.
  define: {
    __API_ORIGIN__: JSON.stringify(process.env.API_TARGET ?? ""),
  },
  plugins: [
    // oxc (the transform behind @vitejs/plugin-react@6) does not lower TC39
    // standard decorators, so it would pass MobX's `@observable accessor`
    // through unchanged and break at runtime (oxc-project/oxc#20133). A
    // dedicated Babel pre-pass lowers decorators in @tangent/windows' .ts model
    // files before oxc strips types. Kept separate from the react-compiler pass
    // so the compiler preset's file filter doesn't skip this workspace package,
    // and to avoid TSX-vs-TS parsing conflicts (decorators live only in .ts).
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
    // React Compiler runs as a Babel preset. @vitejs/plugin-react@6 dropped
    // inline Babel, so it is wired in through @rolldown/plugin-babel. The babel
    // step must run before react() so the compiler sees source JSX, not the
    // already-transformed output of react()'s oxc transform.
    babel({ presets: [reactCompilerPreset()] }),
    react(),
    tailwindcss(),
    embedDevChannel(),
  ],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // The SDK barrel UI extensions import. In-repo (harness, type checks) the
      // bare specifier resolves to the runtime module; sandboxed components get
      // it injected by the worker module loader at runtime instead. Matched
      // exactly so subpaths (e.g. `@tangent/ui-extensions-sdk/contracts/*`)
      // still resolve to the real package.
      {
        find: /^@tangent\/ui-extensions-sdk$/,
        replacement: path.resolve(
          __dirname,
          "./src/features/bundle-ui/runtime/bridge.tsx",
        ),
      },
    ],
  },
  server: {
    allowedHosts: [".tunnel.shopifycloud.tech"],
    // Runtime-generated, agent-owned roots (see server/src/config.ts). Agents
    // constantly write here, so keep them out of the dev watcher to avoid
    // spurious reloads.
    watch: {
      ignored: ["**/.sessions/**", "**/.agent-bundles/**", "**/.memory/**"],
    },
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/socket.io": {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
