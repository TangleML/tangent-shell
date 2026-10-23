import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { createFileTools } from "./remoteFileTools.ts";
import {
  globMatcher,
  isDeniedReadPath,
  resolveWithinRoot,
} from "./workspaceFs.ts";

let root = "";
let outside = "";

async function put(relative: string, content: string | Buffer): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "tangent-tools-"));
  outside = await mkdtemp(path.join(tmpdir(), "tangent-outside-"));
  await writeFile(path.join(outside, "secret.txt"), "secret");
  await put("README.md", "# Hello\n");
  await put("src/index.ts", "export const answer = 42;\n// TODO later\n");
  await put("src/lib/util.ts", "export function todo() {}\n");
  await put("src/lib/util.test.ts", "test('todo')\n");
  await put("node_modules/pkg/index.ts", "// TODO hidden\n");
  await put("image.bin", Buffer.from([0x89, 0x00, 0x01, 0x02]));
  await put("big.txt", "x".repeat(2000));
  await symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const tools = () => createFileTools(() => root);
const call = async (name: string, args: unknown): Promise<unknown> =>
  tools()[name]?.execute(args);

test("resolveWithinRoot rejects absolute and escaping paths", () => {
  assert.equal(
    resolveWithinRoot("/ws", "src/a.ts"),
    path.resolve("/ws/src/a.ts"),
  );
  assert.equal(resolveWithinRoot("/ws", "..file"), path.resolve("/ws/..file"));
  assert.throws(() => resolveWithinRoot("/ws", "../etc/passwd"), /outside/);
  assert.throws(() => resolveWithinRoot("/ws", "src/../../x"), /outside/);
  assert.throws(() => resolveWithinRoot("/ws", "/etc/passwd"), /relative/);
});

test("globMatcher matches names anywhere and paths from the root", () => {
  assert.ok(globMatcher("*.ts")("src/lib/util.ts"));
  assert.ok(globMatcher("src/**/*.test.ts")("src/lib/util.test.ts"));
  assert.ok(globMatcher("src/**/*.ts")("src/index.ts"));
  assert.ok(globMatcher("*.{md,ts}")("README.md"));
  assert.ok(!globMatcher("src/*.ts")("src/lib/util.ts"));
  assert.ok(!globMatcher("*.ts")("README.md"));
});

test("read_file returns text and truncates past maxBytes", async () => {
  assert.equal(await call("read_file", { path: "README.md" }), "# Hello\n");
  const truncated = (await call("read_file", {
    path: "big.txt",
    maxBytes: 10,
  })) as string;
  assert.match(truncated, /^x{10}\n… truncated \(showing 10 of 2000 bytes\)$/);
});

test("read_file refuses binary files, escapes, and outbound symlinks", async () => {
  await assert.rejects(call("read_file", { path: "image.bin" }), /binary/);
  await assert.rejects(call("read_file", { path: "../secret.txt" }), /outside/);
  await assert.rejects(call("read_file", { path: "link.txt" }), /outside/);
  await assert.rejects(call("read_file", {}), /"path" is required/);
});

test("list_dir marks directories and hides ignored folders", async () => {
  const listing = (await call("list_dir", {})) as string;
  assert.deepEqual(listing.split("\n"), [
    "big.txt",
    "image.bin",
    "link.txt",
    "README.md",
    "src/",
  ]);
  assert.equal(
    await call("list_dir", { path: "src/lib" }),
    "util.test.ts\nutil.ts",
  );
});

test("find_files walks the tree, skips ignored dirs, and honors maxResults", async () => {
  assert.equal(
    await call("find_files", { glob: "*.ts" }),
    "src/index.ts\nsrc/lib/util.test.ts\nsrc/lib/util.ts",
  );
  assert.equal(
    await call("find_files", { glob: "*.ts", maxResults: 1 }),
    "src/index.ts\n… stopped at 1 results",
  );
  assert.equal(await call("find_files", { glob: "*.py" }), "No files matched.");
});

test("search_text finds literal and regex matches with line numbers", async () => {
  assert.equal(
    await call("search_text", { query: "TODO" }),
    "src/index.ts:2: // TODO later",
  );
  assert.equal(
    await call("search_text", {
      query: "todo",
      ignoreCase: true,
      glob: "src/lib/*.ts",
    }),
    "src/lib/util.test.ts:1: test('todo')\nsrc/lib/util.ts:1: export function todo() {}",
  );
  assert.equal(
    await call("search_text", { query: "answer = \\d+", regex: true }),
    "src/index.ts:1: export const answer = 42;",
  );
  assert.equal(await call("search_text", { query: "a.b" }), "No matches.");
});

test("isDeniedReadPath refuses VCS internals and dotenv secrets", () => {
  assert.ok(isDeniedReadPath(".env"));
  assert.ok(isDeniedReadPath(".env.local"));
  assert.ok(isDeniedReadPath("./.git/config"));
  assert.ok(isDeniedReadPath("nested/.git/HEAD"));
  assert.ok(!isDeniedReadPath("src/env.ts"));
  assert.ok(!isDeniedReadPath("README.md"));
});

test("read_file and search_text never surface secret or VCS paths", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tangent-deny-"));
  try {
    await writeFile(path.join(dir, ".env"), "SECRET=topsecret\n");
    await mkdir(path.join(dir, ".git"), { recursive: true });
    await writeFile(path.join(dir, ".git", "config"), "token = abc\n");
    await writeFile(path.join(dir, "app.ts"), "const SECRET = 1;\n");
    const deny = createFileTools(() => dir);

    await assert.rejects(
      Promise.resolve(deny.read_file?.execute({ path: ".env" })),
      /not readable/,
    );
    await assert.rejects(
      Promise.resolve(deny.read_file?.execute({ path: ".git/config" })),
      /not readable/,
    );
    assert.equal(
      await deny.search_text?.execute({ query: "SECRET" }),
      "app.ts:1: const SECRET = 1;",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tools fail clearly when no folder is open", async () => {
  const closed = createFileTools(() => undefined);
  await assert.rejects(
    Promise.resolve(closed.list_dir?.execute({})),
    /No folder is open/,
  );
});
