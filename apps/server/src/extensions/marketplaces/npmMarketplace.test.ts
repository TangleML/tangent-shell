import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { NpmMarketplace } from "./npmMarketplace.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface StubPackage {
  name: string;
  version?: string;
  description?: string;
  keywords?: string[];
}

/** Stubs `fetch` with an npm search response and records the requested URL. */
function stubSearch(packages: StubPackage[]): { getUrl: () => string } {
  let url = "";
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    url = String(input);
    return new Response(
      JSON.stringify({ objects: packages.map((pkg) => ({ package: pkg })) }),
      { status: 200 },
    );
  }) as typeof fetch;
  return { getUrl: () => url };
}

test("drops results without the pi-package keyword", async () => {
  stubSearch([
    { name: "pi-foo", version: "1.0.0", keywords: ["pi-package"] },
    { name: "random-lib", version: "2.0.0", keywords: ["other"] },
    { name: "no-keywords", version: "3.0.0" },
  ]);

  const listings = await new NpmMarketplace().search("foo");

  assert.deepEqual(
    listings.map((l) => l.name),
    ["pi-foo"],
  );
});

test("scopes an empty query to the pi-package keyword", async () => {
  const { getUrl } = stubSearch([]);

  await new NpmMarketplace().search("");

  const text = new URL(getUrl()).searchParams.get("text");
  assert.equal(text, "keywords:pi-package");
});
