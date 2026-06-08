import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

import noClassnameOnPrimitives from "./eslint-rules/no-classname-on-primitives.js";

// Tangle UI primitives that reject `className` in feature/route code. Their own
// implementations under src/shared/ui/** own their `cn`/`cva` calls and are
// exempt. `Link` is intentionally omitted because it collides with TanStack
// Router's <Link>, and `Box` is soft-banned (allowed escape hatch, warned on).
const TANGLE_UI_PRIMITIVES = [
  "Button",
  "Textarea",
  "Icon",
  "Text",
  "Paragraph",
  "Heading",
  "BlockStack",
  "InlineStack",
  "Spinner",
  "Progress",
  "IconButton",
  "Surface",
  "Section",
  "Card",
  "ListRow",
  "ScrollRegion",
  "Truncating",
  "HoverReveal",
  "EmptyState",
  "Pill",
  "StickyHeader",
  "Toolbar",
  "Divider",
  "Badge",
  "Page",
  "CenteredScreen",
];

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
    // Vendored Tangle UI primitives are taken as-is from the sister project and
    // rely on `ref as Ref<any>` polymorphic-element casts. Allow `any` here so we
    // can track upstream without local churn.
    files: ["src/shared/ui/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Enforce the design system in user-land: feature and route code must use
    // semantic props / layer-3 patterns instead of raw `className` on Tangle UI
    // primitives. The primitives' own files (src/shared/ui/**) are excluded so
    // they keep their `cn`/`cva` internals. Local primitives are exempt because
    // they style raw HTML elements (div/span/textarea), which the rule ignores.
    files: ["src/features/**/*.tsx", "src/routes/**/*.tsx"],
    plugins: {
      "tangle-ui": { rules: { "no-classname-on-primitives": noClassnameOnPrimitives } },
    },
    rules: {
      // `Box` is intentionally NOT soft-banned here: it is the token-only escape
      // hatch (no `className`), so it satisfies the "no custom classNames" goal.
      "tangle-ui/no-classname-on-primitives": [
        "error",
        { components: TANGLE_UI_PRIMITIVES },
      ],
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
