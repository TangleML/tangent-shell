import base from "@tangent/build/eslint/base";

export default [
  { ignores: ["node_modules"] },
  ...base,
  {
    files: ["src/**/*.tsx"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];
