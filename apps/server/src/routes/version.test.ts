import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";

import express from "express";

import packageJson from "../../package.json" with { type: "json" };
import { handleGetVersion } from "./version.ts";

test("GET /api/version returns only the server name and version without authentication", async (t) => {
  const app = express();
  app.get("/api/version", handleGetVersion);

  const server = app.listen(0, "127.0.0.1");
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/version`, {
    signal: AbortSignal.timeout(5_000),
  });

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/json\b/i,
  );
  assert.deepEqual(await response.json(), {
    name: packageJson.name,
    version: packageJson.version,
  });
});
