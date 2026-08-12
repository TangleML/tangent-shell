import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BearerCredential,
  deniedCredential,
  HandshakeTokenCredential,
  InheritedTokenCredential,
  mintSecretCredential,
} from "./credentials.ts";

test("a bearer credential accepts only its own token, exactly", () => {
  const credential = new BearerCredential("internal-bearer", "s3cret");

  assert.equal(credential.verify({ authorization: "Bearer s3cret" }), true);
  assert.equal(credential.verify({ authorization: "Bearer s3cre" }), false);
  assert.equal(credential.verify({ authorization: "bearer s3cret" }), false);
  assert.equal(credential.verify({ authorization: "s3cret" }), false);
  assert.equal(credential.verify({}), false);
});

test("an unset secret authorizes nobody, rather than everybody", () => {
  // The direction this has to fail in: a server with no token configured must
  // refuse every caller, including one presenting the empty string.
  const bearer = new BearerCredential("internal-bearer", "");
  const handshake = new HandshakeTokenCredential("");

  assert.equal(bearer.configured, false);
  assert.equal(bearer.verify({ authorization: "Bearer " }), false);
  assert.equal(handshake.configured, false);
  assert.equal(handshake.verify({ token: "" }), false);
  assert.equal(handshake.verify({ token: undefined }), false);
});

test("the handshake credential reads the handshake, not a header", () => {
  const credential = new HandshakeTokenCredential("env-token");

  assert.equal(credential.verify({ token: "env-token" }), true);
  assert.equal(credential.verify({ token: "other" }), false);
  assert.equal(credential.verify({ authorization: "Bearer env-token" }), false);
});

test("only an inherited credential hands its secret to a spawned child", () => {
  const inherited = new InheritedTokenCredential("tok");

  assert.deepEqual(inherited.spawnEnv(), { TANGENT_INTERNAL_TOKEN: "tok" });
  assert.deepEqual(
    new BearerCredential("internal-bearer", "tok").spawnEnv(),
    {},
  );
  assert.deepEqual(new HandshakeTokenCredential("tok").spawnEnv(), {});
  assert.deepEqual(deniedCredential.spawnEnv(), {});
});

test("the same secret verifies the same way however it was issued", () => {
  // `inherited-token` and `internal-bearer` differ only in issuance, so a Pi
  // child and a bundle tool presenting the token it inherited both pass.
  const inherited = new InheritedTokenCredential("shared");
  const bearer = new BearerCredential("internal-bearer", "shared");
  const presented = { authorization: "Bearer shared" };

  assert.equal(inherited.verify(presented), true);
  assert.equal(bearer.verify(presented), true);
  assert.notEqual(inherited.scheme, bearer.scheme);
});

test("a minted secret opens its own subject and nothing else", () => {
  const a = mintSecretCredential();
  const b = mintSecretCredential();

  assert.notEqual(a.secret, b.secret);
  assert.equal(a.verify({ authorization: `Bearer ${a.secret}` }), true);
  assert.equal(a.verify({ authorization: `Bearer ${b.secret}` }), false);
  assert.equal(a.scheme, "minted-secret");
});

test("the denied credential authorizes nothing at all", () => {
  assert.equal(deniedCredential.scheme, "none");
  assert.equal(deniedCredential.configured, false);
  assert.equal(deniedCredential.verify({ authorization: "Bearer x" }), false);
  assert.equal(deniedCredential.verify({ token: "x" }), false);
});
