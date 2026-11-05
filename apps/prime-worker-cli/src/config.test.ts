import assert from "node:assert/strict";
import { test } from "node:test";

import { parseConfig } from "./config.ts";

test("a pasted session URL supplies both the Shell URL and the session", () => {
  const config = parseConfig(
    ["--session", "https://example.test/shell/sessions/abc-123?tab=chat"],
    {},
  );
  assert.equal(config.shellUrl, "https://example.test/shell");
  assert.equal(config.sessionId, "abc-123");
});

test("--new needs a Shell URL, from the environment, and no --session", () => {
  const env = { TANGENT_SHELL_URL: "https://example.test/" };
  assert.equal(parseConfig(["--new", " Runs "], env).title, "Runs");
  assert.throws(() => parseConfig(["--new", "a", "--session", "b"], env));
  assert.throws(() => parseConfig(["--new", "a"], {}), /TANGENT_SHELL_URL/);
});

test("a project link supplies the Tangle URL and needs no Shell URL", () => {
  const config = parseConfig(
    ["--new", "Runs", "--project", "https://tangle.test/projects/p-1?tab=x"],
    {},
  );
  assert.deepEqual(config.project, {
    tangleUrl: "https://tangle.test",
    projectId: "p-1",
    workspace: undefined,
  });
  assert.equal(config.shellUrl, undefined);
});

test("--workspace needs --new, a Tangle URL, and no --project", () => {
  const env = { TANGLE_URL: "https://tangle.test/" };
  const config = parseConfig(["--new", "a", "--workspace", "Test"], env);
  assert.equal(config.project?.tangleUrl, "https://tangle.test");
  assert.equal(config.project?.workspace, "Test");
  assert.throws(() => parseConfig(["--session", "s", "--workspace", "T"], env));
  assert.throws(() =>
    parseConfig(["--new", "a", "--workspace", "T", "--project", "p"], env),
  );
  assert.throws(
    () => parseConfig(["--new", "a", "--project", "p"], {}),
    /TANGLE_URL/,
  );
  assert.throws(
    () =>
      parseConfig(
        ["--new", "a", "--workspace", "T", "--url", "https://s.test"],
        env,
      ),
    /drop --url/,
  );
  assert.throws(
    () =>
      parseConfig(
        ["--new", "a", "--url", "https://s.test", "--tangle", "https://t.test"],
        {},
      ),
    /--tangle needs/,
  );
});
