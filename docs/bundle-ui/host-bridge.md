# Host bridge

The **host bridge** is the only channel a sandboxed component has to the outside
world. It is a small set of functions the host exposes to the worker over
[`@quilted/threads`](https://github.com/lemonmade/quilt) (Phase 5). A component
cannot touch the DOM, read app state, reach storage, or hit the network
directly — every side effect goes through one of these three calls, and network
egress in particular is mediated and allowlisted by the host via `fetch`.

```ts
type UICommand = { type: "collapse" };

interface HostBridge {
  getProps(): Promise<Record<string, unknown>>;
  sendPrompt(text: string): Promise<void>;
  fetch(input: string, init?: HostRequestInit): Promise<HostResponse>;
  getState(key: string): Promise<unknown>;
  setState(key: string, value: unknown): Promise<void>;
  execUICommand(command: UICommand): Promise<void>;
}
```

All arguments and return values cross a thread boundary, so they **must be
JSON-serializable**. Functions, DOM nodes, class instances, and other non-cloneable
values are rejected.

## `getProps()`

Returns the JSON props for a `message` component — the parsed body of the
`tangent-ui:<name>` token the agent emitted (see
[`authoring-guide.md`](authoring-guide.md)). For `panel` components there are no
agent props; `getProps()` resolves to an empty object.

- Shape: any JSON object the author defines (e.g. `{ "pipelineId": "exp_123" }`).
- Props may be **incomplete** while the agent's message is still streaming. A
  component must tolerate partial/empty props and render a sensible placeholder
  (see [`rules.md`](rules.md)).

## `sendPrompt(text)`

Composes a chat message and sends it to Prime, exactly as if the user had typed
it. Used by `panel` components to turn a form into a prompt.

- On the host, `sendPrompt` is wired to `send(content, attachments?)` from
  [`src/features/chat/hooks/useSessionChat.ts`](../../src/features/chat/hooks/useSessionChat.ts),
  which emits the message over the session socket. The bridge passes only
  `text`; attachments are out of scope for the initial bridge.
- `text` must be a non-empty string. Empty/whitespace-only prompts are ignored
  (mirroring `send()`'s existing trim/guard).
- Resolves once the message is emitted; it does not wait for the agent's reply.

## `getState(key)` / `setState(key, value)`

A small, host-mediated key-value store that lets a component persist UI state
(e.g. an expanded section, a selected tab) so it survives page reloads.

- `key` is a component-chosen, non-empty string. The component owns its own
  keyspace; the host only owns the surrounding namespace.
- `value` must be JSON-serializable; it is stored verbatim and returned as-is.
- `getState` resolves the stored value, or `null` when nothing is stored (or
  when persistence is unavailable for this surface).
- Storage is scoped **per component instance**: the host namespaces every key
  by the chat session and the message instance (message id + component name +
  occurrence index), so two components — or two instances of the same component
  — never read each other's state. The component never sees this namespace; it
  only supplies `key`.
- Persistence is **message-surface only**. `panel` components have no message
  instance, so `getState` resolves to `null` and `setState` is a no-op.
- The host backs this with `localStorage`; the component never touches storage
  directly. Writes are best-effort (a full or unavailable store fails silently).

```ts
const expanded = (await host.getState("expanded")) === true;
// ...later, on toggle:
await host.setState("expanded", !expanded);
```

## `execUICommand(command)`

A single, extensible entry point for host UI actions a component can request.
Modeled as a discriminated `UICommand` union so new actions can be added later
without growing the bridge surface.

- `{ type: "collapse" }` — collapses the chat message the component is rendered
  in (the same collapse the message's own control performs); the user can expand
  it again from the collapsed affordance.
- Message-surface only: on a `panel`, or for an unrecognized command, the call
  is a no-op.

```ts
await host.execUICommand({ type: "collapse" });
```

## `fetch(input, init?)`

The single, general-purpose data method. It mirrors the web `fetch` API but is
**mediated by the host**: every request is proxied through a server-side
**egress proxy** (Phase 5) that enforces an allowlist of permitted destinations,
attaches credentials, and returns a sanitized response. This is the only way a
component reaches the network — there is no raw `fetch` and no bespoke per-call
RPC. Generalizing to a `fetch` shape means the host (not the component) owns and
controls all egress: which destinations are reachable, with what auth, under what
limits.

```ts
interface HostRequestInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; // default "GET"
  headers?: Record<string, string>; // allowlisted header names only
  body?: unknown; // JSON-serializable; sent as JSON
  query?: Record<string, string | number | boolean>;
}

interface HostResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>; // allowlisted subset
  json?: unknown; // parsed when the response is JSON
  text?: string; // raw text otherwise
}
```

- `input` is a **real, absolute `https://` URL** for the destination. The proxy
  matches it against allowlisted host/path patterns; authors name the actual
  endpoint (e.g. `https://oasis.shopify.io/api/executions/<id>/state`) rather
  than a logical alias.
- The proxy **rejects any destination not on the allowlist** before making a
  network call, and strips/normalizes headers in both directions. Credentials
  the destination needs are injected server-side and never reach the worker.
- A live `Response` cannot cross the thread boundary, so the bridge returns a
  JSON-safe `HostResponse` instead. Read `response.json` (or `response.text`).

### Egress allowlist

The allowlist is **server-owned configuration**, not something the component can
expand. Each rule pins a method + a URL matcher (origin + path pattern) and the
credentials the proxy injects. The implementation lives in
[`server/src/bundleUi/egressAllowlist.ts`](../../server/src/bundleUi/egressAllowlist.ts):

```ts
// server side, abridged
const EGRESS_RULES = [
  {
    method: "GET",
    matches: (url) =>
      url.origin === "https://oasis.shopify.io" &&
      /^\/api\/executions\/[^/]+\/state$/.test(url.pathname),
    // optional bearer token attached server-side; never exposed to the worker
    headers: oasisAuthHeaders,
  },
];
```

A request whose method+URL does not match any rule is denied. New destinations
are enabled by adding rules server-side, never by the component naming an
arbitrary URL. (Per-bundle allowlists are a future refinement — see
[`security.md`](security.md).)

### Example

Request from the component:

```ts
const id = "019ea56d72cd5f4d75f6";
const res = await host.fetch(
  `https://oasis.shopify.io/api/executions/${id}/state`,
);
if (!res.ok) throw new Error(`status ${res.status}`);
const summary = (res.json as { child_execution_status_summary: unknown })
  .child_execution_status_summary;
```

Illustrative `res.json`:

```json
{
  "child_execution_status_summary": {
    "total_executions": 13,
    "ended_executions": 4,
    "has_ended": false
  }
}
```

## Error handling

- **Validation errors** (non-serializable args, empty `sendPrompt` text, a
  `fetch` destination not on the egress allowlist) reject the returned promise
  with a descriptive `Error`. The component should `try/catch` and render a
  fallback.
- **HTTP errors** surface as a resolved `HostResponse` with `ok: false` and the
  `status` set; the promise does not reject for non-2xx (mirroring web `fetch`).
  Always check `res.ok`.
- **Downstream failures** (the proxied request errors or times out at the
  transport level) reject with a generic, non-leaking message; the host logs
  details server-side. Components must not assume `fetch` succeeds.
- **Worker crashes** are contained: a thrown error in the component tears down
  that one `BundleUiHost` instance and renders a quiet error placeholder; it does
  not affect the rest of the chat.
- Errors carry no host internals (stack frames, URLs, tokens) across the bridge.

## What the bridge deliberately does NOT expose

- No **unmediated** network. `host.fetch` is the only egress, and every request
  passes through the server-side allowlist proxy. The worker's own `fetch` is
  forbidden by contract and blocked under the hardened transport (see the Worker
  `fetch` caveat in [`security.md`](security.md)).
- No host DOM, `window`, `document`, cookies, or app state. The only persisted
  state is the **host-mediated** `getState`/`setState` store above; the
  component never touches `localStorage` (or any other storage) directly.
- No arbitrary destinations — `host.fetch` can only reach allowlisted
  destinations; the component cannot expand the allowlist.
