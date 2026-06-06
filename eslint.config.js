import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // The orchestrator extension is authored against Pi's runtime (not this
  // repo's deps), is `@ts-nocheck`, and is excluded from the server tsconfig,
  // so it is excluded from linting too.
  { ignores: ["dist", "server/src/pi/extensions/**"] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      // Flat `recommended-latest` includes the React Compiler rules.
      reactHooks.configs.flat["recommended-latest"],
    ],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-refresh": reactRefresh,
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    // shadcn primitives and the route tree intentionally export non-component
    // values alongside components, which is fine outside of Fast Refresh.
    files: ["src/shared/ui/**/*.tsx", "src/routes/routeTree.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // Backend code runs under Node and has no React/Fast-Refresh concerns.
    // Enforce a low cyclomatic-complexity ceiling to keep functions readable.
    files: ["server/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      complexity: ["error", 6],
      "max-depth": ["warn", 3],
      "max-lines-per-function": ["warn", 60],
    },
  },
);
