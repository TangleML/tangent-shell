import assert from "node:assert/strict";
import { test } from "node:test";

import { assertPiVersion } from "./piVersion.ts";

test("accepts the minimum Pi and anything newer", () => {
  for (const output of ["1.6.0\n", "1.6.3", "1.10.0", "2.0.0"]) {
    assert.doesNotThrow(() => assertPiVersion("pi", () => output), output);
  }
});

test("rejects a Pi older than the minimum", () => {
  for (const output of ["1.5.9", "0.99.0", "0.84.4\n"]) {
    assert.throws(
      () => assertPiVersion("pi", () => output),
      /needs Pi 1\.6\.0 or later/,
      output,
    );
  }
});

test("rejects output with no version in it", () => {
  assert.throws(
    () => assertPiVersion("pi", () => "unknown option"),
    /needs Pi 1\.6\.0 or later/,
  );
});

test("names the binary when it can't be run", () => {
  assert.throws(
    () =>
      assertPiVersion("/opt/missing-pi", () => {
        throw new Error("ENOENT");
      }),
    /Could not run "\/opt\/missing-pi --version"/,
  );
});
