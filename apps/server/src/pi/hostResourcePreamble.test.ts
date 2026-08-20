import assert from "node:assert/strict";
import { test } from "node:test";

import type { ResourceCatalog } from "../conversation/resourceCatalog.ts";
import type { Resource } from "../store/resourceStore.ts";
import {
  HostResourcePreamble,
  renderHostResourcesPreamble,
} from "./hostResourcePreamble.ts";

function resource(overrides: Partial<Resource>): Resource {
  return {
    id: overrides.id ?? "r1",
    sessionId: "s1",
    kind: "host",
    name: "Orders pipeline",
    uri: "https://tangent.example/pipelines/orders",
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Resource;
}

test("renderHostResourcesPreamble is empty when no host resources", () => {
  assert.equal(renderHostResourcesPreamble([]), "");
  assert.equal(renderHostResourcesPreamble([resource({ kind: "memory" })]), "");
});

test("renderHostResourcesPreamble lists each host row's name, uri, and description", () => {
  const text = renderHostResourcesPreamble([
    resource({
      meta: { description: "Ingests orders and flags anomalies." },
    }),
  ]);
  assert.match(text, /## Host resources/);
  assert.match(text, /Orders pipeline/);
  assert.match(text, /https:\/\/tangent\.example\/pipelines\/orders/);
  assert.match(text, /Ingests orders and flags anomalies\./);
  assert.match(text, /read_resources/);
});

test("HostResourcePreamble.get reflects the catalog after refresh", async () => {
  const hosts = [resource({})];
  const catalog = {
    listForSession: async () => hosts,
  } as unknown as ResourceCatalog;
  const preamble = new HostResourcePreamble(catalog);

  assert.equal(preamble.get("s1"), "");
  await preamble.refresh("s1");
  assert.match(preamble.get("s1"), /Orders pipeline/);

  preamble.forget("s1");
  assert.equal(preamble.get("s1"), "");
});
