---
name: page-host-bridge
description: How a sandboxed page asks its host to fire trigger callbacks and open links via postMessage. Use whenever a page needs a form to submit somewhere (RSVP, contact, signup, survey, waitlist, feedback, order interest) or a link/button to reach a callback or an external site.
---

# Page ↔ host bridge

Pages render inside a sandboxed, opaque-origin iframe (no `allow-same-origin`).
A page therefore **cannot** reach app endpoints on its own: a direct `fetch` or a
form `action` sends no credentials and the URL gets rewritten by the proxy, so
the request never lands. Instead, ask the host to act on the page's behalf with
`window.parent.postMessage`. The host validates every message before acting.

This is the only supported way for a generated page to submit a callback or open
a link. Do not use a form `action`, a direct `fetch` to the callback URL, or
`fetch(..., { mode: "no-cors" })` — they appear to work locally but fail in a
real deployment.

## Fire a trigger callback

Submit with vanilla JavaScript — never a form `action`:

1. `event.preventDefault()` on submit.
2. `requestId = crypto.randomUUID()` — used to match the host's reply.
3. `body = Object.fromEntries(new FormData(form))` — string field values only.
4. Post the message:

   ```js
   window.parent.postMessage(
     { type: "tangent:callback", requestId, path: CALLBACK_PATH, body },
     "*",
   );
   ```

   - `CALLBACK_PATH` is the path returned when the trigger was created (it starts
     with `/api/sessions/...`). Pass it through unchanged — do not rewrite it.
   - `body` defaults to `application/x-www-form-urlencoded` (matches trigger
     interpolation like `{{body.name}}`). Add `encoding: "json"` to send JSON.

The host replies with a `message` event:

```js
{
  type: ("tangent:callback:result", requestId, ok, status);
}
```

Match on `requestId`, then show success when `ok` is true and a calm retry
message otherwise. Show a "sending…" state until the reply arrives — never show
success or failure before it.

## Open an external link

A plain anchor opens in a new top-level tab:

```html
<a href="https://example.com" target="_blank" rel="noopener">Open</a>
```

To open a link from script, post `{ type: "tangent:openUrl", url }` instead.

## What the host enforces

Build pages that stay inside these rules — anything else is silently dropped:

- `path` must be a callback under the **current session**:
  `/api/sessions/<thisSession>/triggers/<id>/callback/<secret>`. No other endpoint
  can be called through the bridge.
- `openUrl` is **http/https only**; `javascript:` / `data:` URLs are ignored.
- Only `{ ok, status }` comes back — never a response body.

## Reference implementation

```html
<form id="rsvp-form">
  <!-- inputs with stable name attributes; an aria-live status region -->
</form>
<p id="status" aria-live="polite"></p>

<script>
  const CALLBACK_PATH = "CALLBACK_PATH"; // from trigger creation
  const form = document.querySelector("#rsvp-form");
  const status = document.querySelector("#status");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    status.textContent = "Sending...";

    const requestId = crypto.randomUUID();
    const body = Object.fromEntries(new FormData(form));

    function onResult(event) {
      const data = event.data;
      if (!data || data.type !== "tangent:callback:result") return;
      if (data.requestId !== requestId) return;
      window.removeEventListener("message", onResult);
      status.textContent = data.ok
        ? "Submitted! Watch for the echo in the session."
        : "Could not submit just now — please try again.";
      if (data.ok) form.reset();
    }

    window.addEventListener("message", onResult);
    window.parent.postMessage(
      { type: "tangent:callback", requestId, path: CALLBACK_PATH, body },
      "*",
    );
  });
</script>
```

> Protocol source of truth: `PageBridgeMessage` / `PageCallbackResult` /
> `isPageBridgeMessage` in `@tangent/shared/contracts`. Keep this skill in sync
> with that type — the host enforces the type, this file teaches it.
