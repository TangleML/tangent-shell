import assert from "node:assert/strict";
import { test } from "node:test";

import type { UserIdentity } from "@tangent/shared/contracts.ts";

import { resolveSessionCreator, type SessionDelegation } from "./identity.ts";

const HEADER = "x-forward-user-email";
const DELEGATION: SessionDelegation = {
  delegators: new Set(["bot@example.com"]),
  header: HEADER,
};

const BOT: UserIdentity = {
  email: "Bot@example.com",
  first_name: "Bot",
  last_name: "Service",
};
const ALICE: UserIdentity = {
  email: "alice@example.com",
  first_name: "Alice",
  last_name: "Smith",
};

test("a trusted delegator creates the session for the person it names", () => {
  assert.deepEqual(
    resolveSessionCreator(BOT, { [HEADER]: " Carol@Example.com " }, DELEGATION),
    { email: "carol@example.com", first_name: "", last_name: "" },
  );
});

test("anyone else creates the session for themselves, header or not", () => {
  assert.equal(
    resolveSessionCreator(ALICE, { [HEADER]: "carol@example.com" }, DELEGATION),
    ALICE,
  );
});

test("a delegator that names nobody, or no valid address, stays itself", () => {
  for (const named of [undefined, "", "not-an-email", "a@x.com, b@y.com"]) {
    assert.equal(
      resolveSessionCreator(BOT, { [HEADER]: named }, DELEGATION),
      BOT,
      String(named),
    );
  }
  assert.equal(
    resolveSessionCreator(
      BOT,
      { [HEADER]: ["a@example.com", "b@example.com"] },
      DELEGATION,
    ),
    BOT,
  );
});

test("delegation is off unless both settings are configured", () => {
  const headers = { [HEADER]: "carol@example.com" };
  assert.equal(
    resolveSessionCreator(BOT, headers, { ...DELEGATION, header: "" }),
    BOT,
  );
  assert.equal(
    resolveSessionCreator(BOT, headers, {
      ...DELEGATION,
      delegators: new Set(),
    }),
    BOT,
  );
});

test("an anonymous caller cannot delegate", () => {
  assert.equal(
    resolveSessionCreator(null, { [HEADER]: "carol@example.com" }, DELEGATION),
    null,
  );
});
