import react from "@tangent/build/eslint/react";

export default [
  // `public/` is served verbatim to the browser (static assets, harness
  // samples) and is not part of the typechecked/linted app source.
  { ignores: ["dist", "ui-dist", "node_modules", "public"] },
  ...react,
];
