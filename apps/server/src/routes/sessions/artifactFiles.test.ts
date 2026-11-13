import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Config reads the session root at load time.
const ROOT = mkdtempSync(path.join(tmpdir(), "artifact-files-"));
process.env.SESSIONS_ROOT = ROOT;

const express = (await import("express")).default;
const { createArtifactFileHandler } = await import("./handlers.ts");

const FILES = {
  "page.html": "<html><head></head><body>hi</body></html>",
  "page.HTM": "<p>hi</p>",
  "page.xhtml": "<html xmlns='http://www.w3.org/1999/xhtml'/>",
  "feed.xml": "<a/>",
  "logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
  "doc.pdf": "%PDF-1.4",
  "shot.png": "png",
  "notes.txt": "<script>alert(1)</script>",
  "notes.md": "# hi",
  "data.json": "{}",
  "data.csv": "a,b",
  "page.js": "1",
  noext: "<script>alert(1)</script>",
};

const artifacts = path.join(ROOT, "s1", "artifacts");
mkdirSync(artifacts, { recursive: true });
for (const [name, body] of Object.entries(FILES)) {
  writeFileSync(path.join(artifacts, name), body);
}

const app = express();
app.get("/api/sessions/:id/files/*splat", createArtifactFileHandler());
const server = app.listen(0);
const { port } = server.address() as AddressInfo;
after(() => {
  server.close();
  rmSync(ROOT, { recursive: true, force: true });
});

const get = (name: string) =>
  fetch(`http://127.0.0.1:${port}/api/sessions/s1/files/artifacts/${name}`);

test("a file the browser would run as a page is served sandboxed", async () => {
  for (const name of [
    "page.html",
    "page.HTM",
    "page.xhtml",
    "feed.xml",
    "logo.svg",
  ]) {
    const res = await get(name);
    assert.equal(res.status, 200, name);
    const policy = res.headers.get("content-security-policy") ?? "";
    assert.match(policy, /^sandbox allow-scripts /, name);
    assert.doesNotMatch(policy, /allow-same-origin/, name);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff", name);
  }
});

test("a served HTML page still carries the page bridge", async () => {
  const res = await get("page.html");

  assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(await res.text(), /data-tangent-page-bridge/);
});

test("other files are served unsandboxed, with their type never sniffed", async () => {
  for (const name of [
    "doc.pdf",
    "shot.png",
    "notes.txt",
    "notes.md",
    "data.json",
    "data.csv",
    "page.js",
    "noext",
  ]) {
    const res = await get(name);
    assert.equal(res.status, 200, name);
    assert.equal(res.headers.get("content-security-policy"), null, name);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff", name);
    assert.doesNotMatch(res.headers.get("content-type") ?? "", /html|xml/);
  }
});
