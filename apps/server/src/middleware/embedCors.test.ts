import assert from "node:assert/strict";
import { test } from "node:test";

import type { Request, Response } from "express";

import { createEmbedCors } from "./embedCors.ts";

const ORIGINS = ["https://host.example", "http://localhost:3000"];

function invokeCors(
  allowedOrigins: string[],
  method: string,
  origin?: string,
  requestedHeaders?: string,
) {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let ended = false;
  let continuations = 0;
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    end() {
      ended = true;
    },
  };
  createEmbedCors(allowedOrigins)(
    {
      method,
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": requestedHeaders,
      },
    } as Request,
    response as unknown as Response,
    () => {
      continuations += 1;
    },
  );
  return { headers, statusCode, ended, continuations };
}

for (const origin of ORIGINS) {
  test(`allowed origin ${origin} is echoed on preflight`, () => {
    const result = invokeCors(
      ORIGINS,
      "OPTIONS",
      origin,
      "authorization,content-type",
    );
    assert.deepEqual(Object.fromEntries(result.headers), {
      "access-control-allow-origin": origin,
      vary: "Origin",
      "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type",
    });
    assert.equal(result.statusCode, 204);
    assert.equal(result.ended, true);
    assert.equal(result.continuations, 0);
  });
}

for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
  test(`allowed ${method} continues with CORS headers`, () => {
    const result = invokeCors(ORIGINS, method, ORIGINS[0]);
    assert.equal(result.headers.get("access-control-allow-origin"), ORIGINS[0]);
    assert.equal(result.headers.get("vary"), "Origin");
    assert.equal(result.ended, false);
    assert.equal(result.continuations, 1);
  });
}

const deniedCases = [
  { name: "empty allowlist", allowed: [], origin: ORIGINS[0] },
  { name: "absent Origin", allowed: ORIGINS, origin: undefined },
  {
    name: "unlisted origin",
    allowed: ORIGINS,
    origin: "https://other.example",
  },
  { name: "different scheme", allowed: ORIGINS, origin: "http://host.example" },
  { name: "different port", allowed: ORIGINS, origin: "http://localhost:3001" },
  { name: "subdomain", allowed: ORIGINS, origin: "https://sub.host.example" },
  { name: "trailing slash", allowed: ORIGINS, origin: "https://host.example/" },
  {
    name: "configured path",
    allowed: ["https://host.example/path"],
    origin: ORIGINS[0],
  },
  { name: "literal wildcard", allowed: ["*"], origin: ORIGINS[0] },
];

for (const { name, allowed, origin } of deniedCases) {
  for (const method of ["OPTIONS", "POST"]) {
    test(`${name}: ${method} emits no permissions`, () => {
      const result = invokeCors(allowed, method, origin);
      assert.equal(result.headers.size, 0);
      assert.equal(result.statusCode, method === "OPTIONS" ? 204 : 200);
      assert.equal(result.ended, method === "OPTIONS");
      assert.equal(result.continuations, method === "OPTIONS" ? 0 : 1);
    });
  }
}

test("unsupported requested headers are not reflected and credentials are not enabled", () => {
  const result = invokeCors(
    ORIGINS,
    "OPTIONS",
    ORIGINS[0],
    "authorization,content-type,x-custom-header",
  );
  assert.equal(result.statusCode, 204);
  assert.equal(result.headers.get("access-control-allow-origin"), ORIGINS[0]);
  assert.equal(
    result.headers.get("access-control-allow-headers"),
    "Authorization, Content-Type",
  );
  assert.equal(result.headers.has("access-control-allow-credentials"), false);
  assert.equal(result.continuations, 0);
});
