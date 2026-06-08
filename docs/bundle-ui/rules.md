# Plugin rules

These are the rules every bundle UI component MUST follow. They exist so a
third-party component stays sandboxed, renders natively, and survives the
streaming lifecycle. Components that violate them may fail to render, be rejected
at compile time, or behave unpredictably.

Keywords follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119): **MUST**,
**SHOULD**, **NEVER**.

## Rendering

- You **MUST** render only elements from the
  [element vocabulary](element-vocabulary.md). Unknown elements do not render.
- You **NEVER** render raw HTML elements (`div`, `span`, `button`, `img`, ...) or
  use `dangerouslySetInnerHTML`. The worker has no host DOM.
- You **NEVER** ship styling: no `className`, inline `style`, `<style>` tags, or
  CSS imports. Spacing and tone come only from the vocabulary's semantic props.
- You **SHOULD** compose layout with `tangent-block-stack` / `tangent-inline-stack`
  and their `gap` props rather than expecting any default margins.

## Props and data

- Props **MUST** be JSON-serializable (no functions, class instances, DOM nodes,
  `Date`, `Map`, `Set`, `undefined`-only fields). Anything crossing the bridge is
  cloned.
- You **MUST** tolerate **incomplete or empty props**. For `message` components,
  props arrive from a possibly still-streaming agent message; render a spinner or
  placeholder until required fields exist.
- You **MUST** get all external data through `host.fetch(input, init?)`. Only
  destinations on the host's egress allowlist are reachable (see
  [`host-bridge.md`](host-bridge.md)).
- You **NEVER** call the worker's global `fetch`, `XMLHttpRequest`, `WebSocket`,
  `import()` of remote URLs, or any other unmediated network API. `host.fetch` is
  the only sanctioned egress; the global ones are forbidden by contract and
  blocked under the hardened transport (see the Worker `fetch` caveat in
  [`security.md`](security.md)).
- You **NEVER** embed secrets, tokens, or hostnames in the component; the egress
  proxy attaches credentials and resolves destinations server-side.

## Prompts and side effects

- You **MUST** send prompts only through `host.sendPrompt(text)` with a non-empty
  string.
- You **SHOULD** make prompt text explicit and self-contained (the agent receives
  it as if the user typed it).
- You **NEVER** read or write host globals: `window`, `document`, `localStorage`,
  `sessionStorage`, `cookie`, `navigator`, app state, or other components.
- You **NEVER** attempt to escape the sandbox (worker introspection, prototype
  pollution, probing for host objects).

## Lifecycle and resilience

- You **MUST** clean up timers, intervals, and polling in effect cleanup; a
  component can be unmounted at any time (message scrolls away, panel closes).
- You **SHOULD** `try/catch` every `host.fetch` and check `res.ok`; degrade
  gracefully (the bridge can reject on validation/transport errors and resolves
  with `ok: false` on HTTP errors).
- You **SHOULD** keep last-known-good state across transient `host.fetch` failures
  rather than flashing an error on every failed poll.
- You **SHOULD** poll at a reasonable interval (seconds, not milliseconds) and
  stop when the relevant state is terminal.

## Size and performance

- You **SHOULD** keep a component small and focused; large bundles slow worker
  startup and inflate the served JS.
- You **SHOULD NOT** pull in heavy third-party libraries; prefer the runtime's
  React and the vocabulary.
- You **MUST NOT** block the worker with long synchronous loops or huge synchronous
  computations; the UI thread waits on the worker's render output.

## Manifest hygiene

- Each component **MUST** be declared in `tangent.yaml` `ui.components` with a
  valid `name` (slug), `kind`, and safe `entry` path (see
  [`manifest.md`](manifest.md)).
- Component `name` values **MUST** be unique within a bundle.
- For `message` components, your `prompts/prime.md` **MUST** instruct the agent to
  emit the matching `tangent-ui:<name>` token with the JSON props the component
  expects.
