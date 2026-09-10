import assert from "node:assert/strict";
import { test } from "node:test";

import { mcpAuthorization } from "./mcpAuthorization.ts";

function headers(
  map: Record<string, string>,
): (name: string) => string | undefined {
  return (name) => map[name.toLowerCase()];
}

test("Authorization: Bearer is used as-is", () => {
  assert.equal(
    mcpAuthorization(headers({ authorization: "Bearer secret" })),
    "Bearer secret",
  );
});

test("falls back to Mcp-Authorization when Authorization is Basic", () => {
  assert.equal(
    mcpAuthorization(
      headers({
        authorization: "Basic dXNlcjpwYXNz",
        "mcp-authorization": "Bearer secret",
      }),
    ),
    "Bearer secret",
  );
});

test("uses Mcp-Authorization when Authorization is absent", () => {
  assert.equal(
    mcpAuthorization(headers({ "mcp-authorization": "Bearer secret" })),
    "Bearer secret",
  );
});

test("Authorization: Bearer wins when both are Bearer", () => {
  assert.equal(
    mcpAuthorization(
      headers({
        authorization: "Bearer primary",
        "mcp-authorization": "Bearer alias",
      }),
    ),
    "Bearer primary",
  );
});

test("returns undefined when neither header carries a Bearer", () => {
  assert.equal(mcpAuthorization(headers({})), undefined);
  assert.equal(
    mcpAuthorization(
      headers({
        authorization: "Basic dXNlcjpwYXNz",
        "mcp-authorization": "Basic dXNlcjpwYXNz",
      }),
    ),
    undefined,
  );
});
