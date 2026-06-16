import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

import base from "./base.js";
import noClassnameOnPrimitives from "./no-classname-on-primitives.js";

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

// React/UI lint layer: the shared baseline plus React Hooks (incl. the React
// Compiler rules via recommended-latest), Fast Refresh, browser globals, and
// the Tangle UI design-system rule that forbids `className` on primitives.
export default [
  ...base,
  // Flat `recommended-latest` includes the React Compiler rules.
  reactHooks.configs.flat["recommended-latest"],
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
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
    // they keep their `cn`/`cva` internals.
    files: ["src/features/**/*.tsx", "src/routes/**/*.tsx"],
    plugins: {
      "tangle-ui": {
        rules: { "no-classname-on-primitives": noClassnameOnPrimitives },
      },
    },
    rules: {
      "tangle-ui/no-classname-on-primitives": [
        "error",
        { components: TANGLE_UI_PRIMITIVES },
      ],
    },
  },
];
