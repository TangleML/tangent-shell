import assert from "node:assert/strict";
import { test } from "node:test";

import { stringify as stringifyYaml } from "yaml";

import { parseManifest } from "./manifest.ts";

/** A minimal valid `tangent.yaml` with the given `software` block. */
function manifestWithSoftware(software: Record<string, string[]>): string {
  return stringifyYaml({
    schemaVersion: 1,
    id: "demo",
    name: "Demo",
    version: "0.1.0",
    prime: { systemPrompt: "prompts/prime.md" },
    software,
  });
}

test("software.npm accepts registry packages with optional versions", () => {
  const result = parseManifest(
    manifestWithSoftware({
      npm: ["better-sqlite3", "@tobilu/qmd:2.8.3", "pg:^8"],
    }),
  );
  assert.ok("manifest" in result, JSON.stringify(result));
});

test("software.npm rejects every non-registry entry by index", () => {
  const result = parseManifest(
    manifestWithSoftware({
      npm: ["pg", "--global", "x:file:/etc", "github:user/repo"],
      pip: ["git+https://example.com/repo.git"],
    }),
  );
  assert.ok("errors" in result);
  assert.deepEqual(
    result.errors.map((error) => error.split(" ")[1]),
    ['"software.npm.1"', '"software.npm.2"', '"software.npm.3"'],
    "only npm entries are validated; other managers stay declarative",
  );
});
