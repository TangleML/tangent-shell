import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  BundleExtensionPolicy,
  ExtensionSelection,
} from "@tangent/shared/contracts.ts";

import { isLockedPolicy, resolveExtensionSelection } from "./selection.ts";

type Case = {
  name: string;
  policy: BundleExtensionPolicy | undefined;
  selection: ExtensionSelection | undefined;
  expected: "all" | string[];
};

const cases: Case[] = [
  // No bundle policy: the session's own value (absent means none).
  {
    name: "no policy, no selection",
    policy: undefined,
    selection: undefined,
    expected: [],
  },
  {
    name: "no policy, all",
    policy: undefined,
    selection: "all",
    expected: "all",
  },
  {
    name: "no policy, none",
    policy: undefined,
    selection: "none",
    expected: [],
  },
  {
    name: "no policy, list",
    policy: undefined,
    selection: ["a", "b"],
    expected: ["a", "b"],
  },

  // Bundle "all": absent inherits all; any selection overrides fully.
  {
    name: "all, no selection",
    policy: "all",
    selection: undefined,
    expected: "all",
  },
  { name: "all, all", policy: "all", selection: "all", expected: "all" },
  { name: "all, none", policy: "all", selection: "none", expected: [] },
  { name: "all, list", policy: "all", selection: ["a"], expected: ["a"] },

  // Bundle list: absent inherits; a list extends; none clears; all widens.
  {
    name: "list, no selection",
    policy: ["a", "b"],
    selection: undefined,
    expected: ["a", "b"],
  },
  {
    name: "list, extend",
    policy: ["a", "b"],
    selection: ["c"],
    expected: ["a", "b", "c"],
  },
  {
    name: "list, overlap dedupes",
    policy: ["a", "b"],
    selection: ["b", "c"],
    expected: ["a", "b", "c"],
  },
  { name: "list, none", policy: ["a", "b"], selection: "none", expected: [] },
  { name: "list, all", policy: ["a", "b"], selection: "all", expected: "all" },

  // Bundle { only }: always exactly those ids, ignoring the session.
  {
    name: "only, no selection",
    policy: { only: ["a"] },
    selection: undefined,
    expected: ["a"],
  },
  {
    name: "only, ignores selection",
    policy: { only: ["a"] },
    selection: ["b"],
    expected: ["a"],
  },
  {
    name: "only empty locks to none",
    policy: { only: [] },
    selection: "all",
    expected: [],
  },
];

for (const testCase of cases) {
  test(`resolveExtensionSelection: ${testCase.name}`, () => {
    assert.deepEqual(
      resolveExtensionSelection(testCase.policy, testCase.selection),
      testCase.expected,
    );
  });
}

test("isLockedPolicy only matches the { only } form", () => {
  assert.equal(isLockedPolicy({ only: ["a"] }), true);
  assert.equal(isLockedPolicy({ only: [] }), true);
  assert.equal(isLockedPolicy("all"), false);
  assert.equal(isLockedPolicy(["a"]), false);
  assert.equal(isLockedPolicy(undefined), false);
});
