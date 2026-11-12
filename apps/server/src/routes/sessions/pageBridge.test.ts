import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { injectPageBridge } from "./pageBridge.ts";

test("injects the bridge before </head>", () => {
  const out = injectPageBridge(
    "<html><head><title>x</title></head><body></body></html>",
  );
  assert.match(out, /data-tangent-page-bridge/);
  assert.ok(out.indexOf("data-tangent-page-bridge") < out.indexOf("</head>"));
});

test("falls back to before </body> when there is no head", () => {
  const out = injectPageBridge("<body><p>hi</p></body>");
  assert.match(out, /data-tangent-page-bridge/);
  assert.ok(out.indexOf("data-tangent-page-bridge") < out.indexOf("</body>"));
});

test("prepends when neither head nor body is present", () => {
  const out = injectPageBridge("<p>fragment</p>");
  assert.ok(out.startsWith("<script data-tangent-page-bridge>"));
  assert.match(out, /<p>fragment<\/p>/);
});

test("is idempotent", () => {
  const once = injectPageBridge("<head></head>");
  const twice = injectPageBridge(once);
  assert.equal(once, twice);
  assert.equal(once.match(/data-tangent-page-bridge/g)?.length, 1);
});

test("matches </head> case-insensitively", () => {
  const out = injectPageBridge("<HEAD></HEAD>");
  assert.ok(out.indexOf("data-tangent-page-bridge") < out.indexOf("</HEAD>"));
});

const PAGE_URL =
  "https://tangent.example/proxy/8000/api/sessions/s1/files/artifacts/workflow/dashboard.html";
const DATA_PATH = "/api/sessions/s1/files/artifacts/workflow/data.json";

interface BridgeRequest {
  type: string;
  requestId: string;
  path: string;
  body?: Record<string, string>;
}

type Listener = (event: { data: unknown }) => void;
type PageFetch = (
  input: unknown,
  init?: { method: string },
) => Promise<Response>;

interface FakePage {
  fetch: PageFetch;
  postedToHost: BridgeRequest[];
  nativeFetches: unknown[];
  receiveFromHost: (data: unknown) => void;
  dispatchOnDocument: (type: string, event: unknown) => void;
}

/** Runs the injected client in a fake page: a sandboxed frame by default. */
function loadPage({ origin = "null", framed = true } = {}): FakePage {
  const postedToHost: BridgeRequest[] = [];
  const nativeFetches: unknown[] = [];
  const messageListeners = new Set<Listener>();
  const documentListeners = new Map<string, (event: unknown) => void>();

  const globals: { fetch: PageFetch; [name: string]: unknown } = {
    origin,
    location: new URL(PAGE_URL),
    document: {
      baseURI: PAGE_URL,
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        documentListeners.set(type, listener),
    },
    fetch: (input) => {
      nativeFetches.push(input);
      return Promise.resolve(new Response("native"));
    },
    addEventListener: (_type: string, listener: Listener) =>
      messageListeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) =>
      messageListeners.delete(listener),
    crypto,
    URL,
    Response,
    setTimeout,
    clearTimeout,
  };
  globals.window = globals;
  globals.parent = framed
    ? {
        postMessage: (message: BridgeRequest) =>
          postedToHost.push(structuredClone(message)),
      }
    : globals;

  const client = /<script[^>]*>\n([\s\S]*)\n<\/script>/.exec(
    injectPageBridge(""),
  );
  assert.ok(client, "the injected client is a single script");
  vm.runInNewContext(client[1], globals);

  return {
    fetch: (input, init) => globals.fetch(input, init),
    postedToHost,
    nativeFetches,
    receiveFromHost: (data) => {
      for (const listener of [...messageListeners]) listener({ data });
    },
    dispatchOnDocument: (type, event) => documentListeners.get(type)?.(event),
  };
}

test("a sandboxed page's fetch of a sibling file is read by the host", async () => {
  const page = loadPage();

  const pending = page.fetch("data.json?t=1");
  const [request] = page.postedToHost;
  assert.equal(request.type, "tangent:fetch");
  assert.equal(request.path, DATA_PATH);

  page.receiveFromHost({
    type: "tangent:fetch:result",
    requestId: request.requestId,
    status: 200,
    contentType: "application/json",
    body: new TextEncoder().encode('{"n":2}').buffer,
  });
  const response = await pending;
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), { n: 2 });
  assert.deepEqual(page.nativeFetches, []);
});

test("fetches the host can't serve go to the browser's own fetch", async () => {
  const page = loadPage();
  const unserved: [unknown, { method: string }?][] = [
    ["data.json", { method: "POST" }],
    ["https://elsewhere.example/api/sessions/s1/files/artifacts/data.json"],
    ["/api/sessions/s2/files/artifacts/data.json"],
    ["/api/sessions/s1/participants"],
  ];

  for (const [input, init] of unserved) await page.fetch(input, init);

  assert.deepEqual(
    page.nativeFetches,
    unserved.map(([input]) => input),
  );
  assert.deepEqual(page.postedToHost, []);
});

test("a read the host refuses or can't make fails the way a fetch does", async () => {
  const page = loadPage();

  const refused = page.fetch("data.json");
  page.receiveFromHost({
    type: "tangent:fetch:result",
    requestId: page.postedToHost[0].requestId,
    status: 403,
  });
  const response = await refused;
  assert.equal(response.ok, false);
  assert.equal(response.status, 403);

  const failed = page.fetch("data.json");
  page.receiveFromHost({
    type: "tangent:fetch:result",
    requestId: page.postedToHost[1].requestId,
    status: 0,
  });
  await assert.rejects(failed, { name: "TypeError" });
});

test("a read the host never answers fails once it times out", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = loadPage();

  const pending = page.fetch("data.json");
  t.mock.timers.tick(15_000);

  await assert.rejects(pending, { name: "TypeError" });
});

test("fetch is left alone outside a sandboxed frame", async () => {
  const sameOrigin = loadPage({ origin: "https://tangent.example" });
  const ownTab = loadPage({ framed: false });

  await sameOrigin.fetch("data.json");
  await ownTab.fetch("data.json");

  assert.deepEqual(sameOrigin.nativeFetches, ["data.json"]);
  assert.deepEqual(ownTab.nativeFetches, ["data.json"]);
  assert.deepEqual(sameOrigin.postedToHost, []);
});

test("a callback link fires through the host and shows the result", () => {
  const page = loadPage();
  const status = { textContent: "", getAttribute: () => null };
  const state = new Map<string, string>();
  const link = {
    tagName: "A",
    style: {},
    getAttribute: () => "/api/sessions/s1/triggers/t1/callback/abc123?rsvp=yes",
    setAttribute: (name: string, value: string) => state.set(name, value),
    querySelector: () => status,
  };

  page.dispatchOnDocument("click", {
    target: { closest: () => link },
    preventDefault: () => {},
  });
  const [request] = page.postedToHost;
  assert.equal(request.type, "tangent:callback");
  assert.equal(request.path, "/api/sessions/s1/triggers/t1/callback/abc123");
  assert.deepEqual(request.body, { rsvp: "yes" });

  page.receiveFromHost({
    type: "tangent:callback:result",
    requestId: request.requestId,
    ok: true,
    status: 200,
  });
  assert.equal(state.get("data-tangent-state"), "success");
  assert.match(status.textContent, /^Sent/);
});
