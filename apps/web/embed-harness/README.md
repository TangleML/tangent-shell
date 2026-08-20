# Embed harness

A minimal, framework-free host page that drives the `tangent-*` custom elements
directly (no npm wrapper), to exercise the runtime bundle, shadow-DOM styling,
`newSession`, and the `on*` events. It deliberately sets its own `--background`
token and a serif font so you can confirm styles do not leak either way.

The page lays out `<tangent-session-list>` (click a row to swap the chat), a
column of `<tangent-agent-list>` + `<tangent-asset-list>`, `<tangent-chat>`, and
`<tangent-artifact-viewer>` (revealed when the chat or asset list opens a page).
Clicking an agent sets `chat.agentId` so the host can show that subagent's
thread. `<tangent-bundled-ui>` is registered by the same runtime; drive it from
your own host page by setting `moduleUrl` + `kind`.

## Build the runtime first

```bash
pnpm --filter @tangent/web build:embed
```

This emits `apps/web/dist/embed/v1/tangent-elements.js` (+ hashed chunks).

## Same-origin (simplest, no CORS wall)

Server auth/CORS hardening is deferred, so cross-origin `/api` calls are blocked
by the browser today. To validate the elements end to end, serve the harness and
the runtime from the **same** origin as the Tangent API.

The straightforward path is the fullstack Docker image, where nginx serves
`/embed/**`, `/api/**`, and static files on one port:

```bash
docker build -f Dockerfile.fullstack -t tangent .
docker run -p 8000:8000 tangent
```

Copy `index.html` next to the served UI (or open it through the same origin) and
load it with `?origin=http://localhost:8000` (or omit `origin` if served from
that origin). Click "New session".

## True cross-origin

Serve `index.html` from a second port (e.g. `npx serve apps/web/embed-harness`)
and point it at the Tangent origin:

```
http://localhost:3000/?origin=https://tangent.example
```

This works once the deferred server hardening lands (Bearer JWT verification,
per-request session authorization, and a CORS allowlist that also sets
`Access-Control-Allow-Origin` on `/api/**` and the Socket.IO handshake). Until
then the runtime module import succeeds (nginx sets CORS on `/embed/**`) but the
first `/api/sessions` call is blocked cross-origin.

## What to validate (shadow-DOM spike)

- The model picker dropdown, message action menus, and session-list row menus
  open, are styled, escape the element's box (they portal to
  `<tangent-overlay-root>`), and trap/restore focus correctly with the keyboard.
  These live in _different_ shadow roots than their triggers, so confirm
  positioning and dismissal too.
- Streaming markdown renders with the right colors — tokens arrive by inheritance
  onto `:host`, not from `:root`.
- Toggling `provider.theme = { colorScheme: "dark" }` reskins every element
  (list, chat, artifact viewer, and the overlay root) without touching the host.
- Selecting a session in `<tangent-session-list>` swaps the chat and the agent /
  asset lists; the live status dots come from the lobby socket via the shared
  runtime.
- Clicking an agent in `<tangent-agent-list>` sets `chat.agentId` (Prime clears
  it); clicking a page in `<tangent-asset-list>` reveals the artifact viewer.
