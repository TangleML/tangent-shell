# Security model

Bundle UI components are **third-party code** running inside a first-party app.
This document states what we defend against, what the sandbox guarantees today,
the known caveats, and the hardening roadmap.

## Threat model

A malicious or buggy component might try to:

1. **Exfiltrate data** — read the user's session, tokens, cookies, or DOM and
   send them somewhere.
2. **Make unauthorized requests** — call internal or external APIs directly.
3. **Tamper with the host** — mutate app state, other components, or the DOM;
   pollute prototypes; hijack events.
4. **Phish / spoof** — render fake host chrome to trick the user.
5. **Degrade the app** — hang the UI, leak memory, or ship enormous payloads.

The design goal: a component can render native-looking UI and reach a small set
of explicitly allowlisted operations, and **nothing else**.

## What the Worker sandbox guarantees today

- **No host DOM.** The component runs in a Web Worker with a remote-dom DOM
  polyfill. It cannot read or write the page's DOM, so it cannot scrape the
  session UI or inject host chrome. It only produces a serialized tree of
  [vocabulary elements](element-vocabulary.md) that the host renders.
- **No host globals or state.** Workers have a separate global scope: no
  `window`, `document`, `localStorage`, `cookie`, or access to React app state.
  The component cannot reach other components or app internals.
- **Fixed render vocabulary.** The host maps only allowlisted remote elements to
  primitives; an unknown element does not render. Components cannot inject styles
  (no `className`/`style`), which limits spoofing of host chrome.
- **Host-controlled egress.** All data flows through `host.fetch(input, init?)`,
  routed through a **server-side egress proxy** that enforces an allowlist of
  permitted destinations and injects credentials (see
  [`host-bridge.md`](host-bridge.md)). The component names a real URL, but the
  proxy validates it (origin + path pattern + method) **before** any network
  call and injects tokens the worker never sees. This is the SSRF boundary: a
  component cannot point the proxy at an arbitrary host, an internal metadata
  endpoint, or a non-allowlisted path — anything off the allowlist is rejected,
  and only an allowlisted subset of response headers is surfaced back.
- **Allowlisted side effects.** The only outbound action is
  `host.sendPrompt(text)`, which posts a normal chat message. There is no generic
  RPC.
- **Crash isolation.** A thrown error tears down that one component instance and
  renders a quiet placeholder; it does not crash the chat or the app.
- **Transpile-only compile.** The server esbuild step (Phase 3) transpiles author
  `.tsx` to JS without executing it, so upload itself runs no plugin code.

## Known caveat: the worker's global `fetch`

The egress allowlist is enforced for **`host.fetch`**: that path is proxied
through the server, so the destination allowlist and credential injection always
apply. The caveat is the worker's _own_ global `fetch` — a Web Worker has access
to the `fetch` API by default. **This is the main limitation of the Worker-only
sandbox**: a determined component could attempt a network request from inside the
worker, bypassing `host.fetch` and its allowlist entirely.

We treat the global `fetch` as **forbidden by contract** ([`rules.md`](rules.md)
NEVER call the global `fetch`), but contract is not enforcement. Mitigations in
the Worker-only stage:

- The worker is loaded from a same-origin script; cross-origin reads are still
  subject to CORS, limiting (not eliminating) exfiltration.
- The bundle ships no secrets to the worker, so there is nothing privileged to
  leak from inside it; sensitive credentials live only on the server behind the
  egress proxy.
- Review/marketplace gating: bundles are author-controlled artifacts; the
  vocabulary + bridge contract makes a global `fetch` (as opposed to
  `host.fetch`) an obvious red flag in review and in the compiled output.

This caveat is the reason for the hardening roadmap below.

## Hardening roadmap

The transport is kept **swappable** (the host abstracts over the worker via
`@quilted/threads`), so we can upgrade isolation without rewriting components.

1. **Worker (current).** Ship the Worker sandbox with the contract above. Good
   isolation of DOM/state; the global-`fetch` caveat remains.
2. **iframe + CSP.** Run the remote-dom environment inside a sandboxed `<iframe>`
   and apply a Content-Security-Policy with `connect-src 'none'` (plus
   `default-src 'none'` and a tightly scoped script source). This makes the
   network boundary **enforced**, not just contractual: the component physically
   cannot open a socket or call the global `fetch`, so the host-proxied
   `host.fetch` becomes the only data path.
3. **Per-bundle policy (future).** Optionally scope the egress allowlist per
   bundle and add quotas/rate limits on the proxy.

Until stage 2 lands, treat `connect-src 'none'` as the target invariant and the
Worker stage as a pragmatic first cut with a clearly documented gap.

## Operational notes

- `host.fetch` responses MUST be scrubbed of host internals server-side
  (allowlisted headers only); errors return generic messages (no stack frames,
  URLs, or tokens) across the bridge.
- Served component JS is `application/javascript` from the bundle's own
  namespace (`/api/agent-bundles/:id/ui/:name.js`); it is not eval'd on the host
  thread — it is imported into the worker.
- Size/perf limits (see [`rules.md`](rules.md)) double as a denial-of-service
  guard against oversized or pathological components.
