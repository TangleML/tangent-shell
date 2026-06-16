import globals from "globals";

import base from "./base.js";

// Node/server lint layer: the shared baseline plus Node globals and a low
// cyclomatic-complexity ceiling to keep backend functions readable. Backend
// code has no React/Fast-Refresh concerns.
export default [
  ...base,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      complexity: ["error", 6],
      "max-depth": ["warn", 3],
      "max-lines-per-function": ["warn", 60],
    },
  },
];
