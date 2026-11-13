import assert from "node:assert/strict";
import { test } from "node:test";

import { createMarketplaceRegistry, MarketplaceRegistry } from "./registry.ts";

test("createMarketplaceRegistry registers npm, git, and file", () => {
  const registry = createMarketplaceRegistry();
  assert.deepEqual(
    registry
      .list()
      .map((marketplace) => marketplace.id)
      .sort(),
    ["file", "git", "npm"],
  );
});

test("parseSource splits on the first colon only", () => {
  const registry = createMarketplaceRegistry();

  const npm = registry.parseSource("npm:pi-foo@1.2.0");
  assert.equal(npm.marketplace.id, "npm");
  assert.equal(npm.ref, "pi-foo@1.2.0");

  // A git url's own `:`/`@` stay in the ref.
  const git = registry.parseSource("git:github.com/user/repo@v1");
  assert.equal(git.marketplace.id, "git");
  assert.equal(git.ref, "github.com/user/repo@v1");

  // A scoped npm name keeps its leading `@`.
  assert.equal(registry.parseSource("npm:@scope/foo").ref, "@scope/foo");
});

test("parseSource rejects a missing separator, unknown source, or empty ref", () => {
  const registry = createMarketplaceRegistry();
  assert.throws(() => registry.parseSource("pi-foo"), /expected/);
  assert.throws(
    () => registry.parseSource("bogus:thing"),
    /unknown marketplace/,
  );
  assert.throws(() => registry.parseSource("npm:"), /missing a ref/);
});

test("an empty registry has no marketplaces", () => {
  assert.deepEqual(new MarketplaceRegistry().list(), []);
});
