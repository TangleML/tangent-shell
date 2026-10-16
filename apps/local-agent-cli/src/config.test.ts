import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { parseCli } from "./config.ts";

const env = { REMOTE_ENV_TOKEN: "secret" };

function parse(argv: string[], extraEnv = {}) {
  const config = parseCli(argv, { ...env, ...extraEnv });
  assert.notEqual(config, "help");
  return config as Exclude<typeof config, "help">;
}

test("a session URL sets the shell origin and scopes the host id", () => {
  const config = parse([
    "--url",
    "http://localhost:5173/sessions/abc?x=1",
    "--host-id",
    "cli-test",
  ]);

  assert.equal(config.url, "http://localhost:5173");
  assert.equal(config.sessionId, "abc");
  assert.equal(config.selector, "sessionId:abc");
  assert.equal(config.environmentId, "abc:cli-test");
  assert.equal(config.token, "secret");
});

test("an explicit session wins over the URL and accepts a pasted URL", () => {
  const config = parse([
    "--url",
    "http://h/sessions/from-url",
    "--session",
    "http://h/sessions/explicit",
    "--host-id",
    "h1",
  ]);

  assert.equal(config.environmentId, "explicit:h1");
});

test("without a session the host connects unscoped with a generated id", () => {
  const config = parse(["--url", "https://shell.example/tangent/"]);

  assert.equal(config.url, "https://shell.example/tangent");
  assert.equal(config.sessionId, undefined);
  assert.equal(config.selector, config.environmentId);
  assert.match(config.environmentId, /^cli-[a-z0-9-]+-[0-9a-f]{8}$/);
});

test("flags fall back to environment variables", () => {
  const config = parse([], {
    TANGENT_SHELL_URL: "http://env-shell",
    TANGENT_PI_BIN: "/opt/pi",
    TANGENT_PI_MODEL: "openai/gpt-5",
  });

  assert.equal(config.url, "http://env-shell");
  assert.equal(config.launch.bin, "/opt/pi");
  assert.equal(config.launch.model, "openai/gpt-5");
});

test("pi launch options resolve cwd and only pass the proxy key with a proxy", () => {
  const plain = parse(["--url", "http://h", "--cwd", "some/dir"], {
    PI_PROXY_API_KEY: "k",
  });
  assert.equal(plain.launch.cwd, path.resolve("some/dir"));
  assert.equal(plain.launch.bin, "pi");
  assert.equal(plain.launch.proxyApiKey, undefined);

  const proxied = parse(["--url", "http://h", "--pi-proxy-url", "https://p"], {
    PI_PROXY_API_KEY: "k",
  });
  assert.equal(proxied.launch.proxyUrl, "https://p");
  assert.equal(proxied.launch.proxyApiKey, "k");
  assert.match(proxied.launch.proxyExtensionPath, /proxyProvider\.ts$/);
});

test("missing URL or token fails clearly; --help short-circuits", () => {
  assert.throws(() => parseCli([], env), /--url/);
  assert.throws(() => parseCli(["--url", "http://h"], {}), /REMOTE_ENV_TOKEN/);
  assert.throws(() => parseCli(["--bogus"], env));
  assert.equal(parseCli(["-h"], {}), "help");
});
