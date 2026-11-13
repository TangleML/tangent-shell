import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { probeExtensionTools } from "./probeTools.ts";

const ROOT = mkdtempSync(path.join(tmpdir(), "probe-"));
after(() => rmSync(ROOT, { recursive: true, force: true }));

const EXTENSION = `export default function (pi) {
  for (const name of ["alpha_tool", "beta_tool"]) {
    pi.registerTool({
      name,
      label: name,
      description: name,
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [], details: {} }),
    });
  }
}
`;

test("enumerates the tools an extension registers", async (t) => {
  const file = path.join(ROOT, "index.js");
  await writeFile(file, EXTENSION);

  const tools = await probeExtensionTools([file], ROOT);
  if (tools === null) {
    t.skip("pi binary not resolvable in this environment");
    return;
  }
  assert.deepEqual([...tools].sort(), ["alpha_tool", "beta_tool"]);
});

test("returns null for an empty path list without spawning", async () => {
  assert.equal(await probeExtensionTools([], ROOT), null);
});
