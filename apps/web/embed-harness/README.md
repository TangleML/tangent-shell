# Embed harness

A minimal, framework-free host page that drives the `tangent-*` custom elements
directly (no npm wrapper), to exercise the runtime bundle, shadow-DOM styling,
`newSession`, and the `on*` events. It deliberately sets its own `--background`
token and a serif font so you can confirm styles do not leak either way.

The page lays out `<tangent-session-list>` (click a row to swap the chat), a
column of `<tangent-agent-list>` + `<tangent-asset-list>` +
`<tangent-resource-list>` + `<tangent-participant-list>`, `<tangent-chat>`, and
`<tangent-artifact-viewer>` (revealed when the chat, asset list, or resource
list opens a page). Clicking an agent sets `chat.agentId` so the host can show
that subagent's thread. Opening a viewable resource points the artifact viewer
at it; toggling a participant's mute mutates the shared session and logs
`toggle-mute`. `<tangent-bundled-ui>` is registered by the same runtime; drive
it from your own host page by setting `moduleUrl` + `kind`.

## Build the runtime first

```bash
pnpm --filter @tangent/web build:embed
```

This emits `apps/web/dist/embed/v1/tangent-elements.js` (+ hashed chunks).

## Same-origin (simplest, no CORS wall)

Same-origin hosting needs no cross-origin API permissions. To validate the elements
end to end without configuring an allowlist, serve the harness and runtime from the
**same** origin as the Tangent API.

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

Set `EMBED_ALLOWED_ORIGINS` in the server's runtime environment to the harness's
exact origin, for example `http://localhost:3000` (use the actual serving port),
then restart the server. The variable accepts trimmed, comma-separated origins
and drives Express API and Socket.IO CORS; do not include paths, trailing slashes,
or wildcards. The `origin` query parameter selects the **Tangent API** origin,
not the host origin to allowlist.

With an empty list, Express grants no cross-origin permissions, while Socket.IO
retains its origin-reflecting development default. The fullstack nginx wildcard
CORS headers on static `/embed/**` assets are separate: a successful runtime module
import does not prove `/api/**` access. CORS is not authorization; existing identity
and session access checks still apply. API CORS permits `Authorization` and
`Content-Type`, not credentialed cookie requests or arbitrary custom headers.

For token-endpoint failures, inspect both preflight and actual POST responses using
the [configuration and troubleshooting guide](../../../README.md#troubleshooting-apiembedremote-env-token).
Local harness checks do not verify a production deployment.

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
- `<tangent-resource-list>` surfaces the session's catalogued content read-only;
  opening a viewable `file`/`artifact` reveals the artifact viewer at its
  resolved url, while `memory`/`attachment` rows are inert.
- `<tangent-participant-list>` shows the roster with live presence; the mute
  toggle on an agent in the active Conversation mutates the shared session and
  emits `toggle-mute`.
