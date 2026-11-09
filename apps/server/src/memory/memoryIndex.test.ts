import assert from "node:assert/strict";
import { test } from "node:test";

import { onlyGrantedTools, renderMemoryIndex } from "./memoryIndex.ts";
import type { MemorySourceInfo } from "./types.ts";

const SOURCES: MemorySourceInfo[] = [
  {
    title: "Session memory",
    scope: "session",
    holds: "Facts for this session only.",
    read: { tools: ["read_memory"] },
    write: { tools: ["remember"] },
    notes: ["Give each fact a short `title`."],
  },
  {
    title: "Project note",
    scope: "project",
    holds: "Standing context.",
    read: { file: "proj/MEMORY.md" },
  },
  {
    title: "`proj/mem`",
    scope: "unavailable",
    holds: "Memory that couldn't be loaded.",
  },
];

test("the index lists each source with its scope, access, and notes", () => {
  const index = renderMemoryIndex(SOURCES, "prime");

  assert.match(index, /^## Memory\n/);
  assert.match(index, /### Index\n\n/);
  assert.ok(
    index.includes(
      "- **Session memory** (this session only): Facts for this session only. " +
        "Read: `read_memory`. Write: `remember`.\n  - Give each fact a short `title`.",
    ),
  );
  assert.ok(
    index.includes(
      "- **Project note** (this project): Standing context. Read: your file tools on `proj/MEMORY.md`.",
    ),
  );
  assert.ok(
    index.includes(
      "- **`proj/mem`** (unavailable): Memory that couldn't be loaded.",
    ),
  );
});

test("the index's rules depend on the role", () => {
  const prime = renderMemoryIndex(SOURCES, "prime");
  assert.match(prime, /never claim to have stored something/);
  assert.doesNotMatch(prime, /read-only for you/);

  const sub = renderMemoryIndex([], "subagent");
  assert.match(sub, /read-only for you/);
  assert.doesNotMatch(sub, /never claim/);
});

test("onlyGrantedTools drops tools the agent wasn't granted", () => {
  const [session, note] = onlyGrantedTools(SOURCES, new Set(["read_memory"]));
  assert.deepEqual(session.read, { tools: ["read_memory"] });
  assert.equal(session.write, undefined);
  assert.deepEqual(note.read, { file: "proj/MEMORY.md" });
});
