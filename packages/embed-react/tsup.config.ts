import { defineConfig } from "tsup";

// The wrapper is deliberately tiny: types and glue, no Tangent UI, CSS, Radix,
// or TanStack. React stays external (the host provides it). A small diff here is
// what makes "the host rarely redeploys" credible.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  external: ["react", "react-dom"],
});
