import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IDENTITY_REFRESH_AFTER_MS,
  IdentityFreshness,
} from "@tangent/shared/identityRefresh.ts";

test("a client with no request yet, or an old one, refreshes before it sends", () => {
  const fresh = new IdentityFreshness();
  assert.equal(fresh.isStale(1_000), true);

  fresh.noteRequest(1_000);
  assert.equal(fresh.isStale(1_000 + IDENTITY_REFRESH_AFTER_MS - 1), false);
  assert.equal(fresh.isStale(1_000 + IDENTITY_REFRESH_AFTER_MS), true);

  fresh.noteRequest(5_000_000);
  assert.equal(fresh.isStale(5_000_001), false);
  assert.equal(IDENTITY_REFRESH_AFTER_MS, 30 * 60 * 1000);
});
