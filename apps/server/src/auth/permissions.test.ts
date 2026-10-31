import assert from "node:assert/strict";
import { test } from "node:test";

import type { BundleEditor } from "@tangent/shared/contracts.ts";

import type { BundleEditorStore } from "../store/bundleEditorStore.ts";
import {
  canEditBundles,
  gateEnabled,
  isAdmin,
  resolvePermissions,
} from "./permissions.ts";

const ADMINS: ReadonlySet<string> = new Set(["admin@example.com"]);
const NO_ADMINS: ReadonlySet<string> = new Set();

/** An editor store over a fixed set of lowercased emails. */
function editorsOf(...emails: string[]): BundleEditorStore {
  const listed = new Set(emails);
  return {
    list: async () => [] as BundleEditor[],
    has: async (email) => listed.has(email),
    add: async () => {
      throw new Error("not used");
    },
    remove: async () => false,
  };
}

test("the gate is off with no admins and everyone may do everything", async () => {
  assert.equal(gateEnabled(NO_ADMINS), false);
  assert.equal(isAdmin(undefined, NO_ADMINS), true);
  assert.deepEqual(
    await resolvePermissions(undefined, editorsOf(), NO_ADMINS),
    {
      isAdmin: true,
      canEditBundles: true,
    },
  );
});

test("admins match case-insensitively and can edit bundles", async () => {
  assert.equal(gateEnabled(ADMINS), true);
  assert.equal(isAdmin(" Admin@Example.COM ", ADMINS), true);
  assert.equal(
    await canEditBundles("ADMIN@example.com", editorsOf(), ADMINS),
    true,
  );
});

test("a listed editor can edit bundles but isn't an admin", async () => {
  const editors = editorsOf("editor@example.com");
  assert.deepEqual(
    await resolvePermissions("Editor@Example.com", editors, ADMINS),
    { isAdmin: false, canEditBundles: true },
  );
});

test("an outsider or anonymous caller gets nothing once the gate is on", async () => {
  const editors = editorsOf("editor@example.com");
  assert.deepEqual(
    await resolvePermissions("someone@example.com", editors, ADMINS),
    { isAdmin: false, canEditBundles: false },
  );
  assert.deepEqual(await resolvePermissions(undefined, editors, ADMINS), {
    isAdmin: false,
    canEditBundles: false,
  });
});
