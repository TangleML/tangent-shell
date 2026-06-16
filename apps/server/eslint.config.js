import node from "@tangent/build/eslint/node";

export default [
  { ignores: ["dist", "src/pi/extensions", "node_modules"] },
  ...node,
];
