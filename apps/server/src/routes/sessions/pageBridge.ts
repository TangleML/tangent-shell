/**
 * Client runtime injected into served HTML page artifacts. The artifact iframe
 * is sandboxed (opaque origin, no `allow-same-origin`), so a page cannot reach
 * the app itself — requests would carry no credentials and the proxy rewrites
 * absolute URLs baked into the HTML. This script runs inside the frame and asks
 * the parent shell to act on its behalf (→ the host's `usePageBridge`):
 *
 * - submitting a `<form action="<callback path>">`, or clicking an
 *   `<a href="<callback path>">`, fires that trigger callback
 *   (`tangent:callback`); a callback link's query string becomes the body;
 * - clicking an `<a>` to another site opens it in a new tab (`tangent:openUrl`).
 *
 * Pages need no JavaScript of their own. Callback paths are normalized at
 * runtime (sliced from `/api/sessions/`), undoing any proxy prefix the served
 * HTML picked up.
 */
const PAGE_BRIDGE_CLIENT = `
(function () {
  if (window.__tangentPageBridge) return;
  window.__tangentPageBridge = true;

  var framed = !!window.parent && window.parent !== window;
  var CALLBACK_RE = /^\\/api\\/sessions\\/[^/]+\\/triggers\\/[\\w-]+\\/callback\\/[a-f0-9]+$/;

  function callbackOf(raw) {
    if (!raw) return null;
    var u;
    try { u = new URL(raw, document.baseURI); } catch (e) { return null; }
    var p = u.pathname;
    var i = p.indexOf("/api/sessions/");
    if (i > 0) p = p.slice(i);
    return CALLBACK_RE.test(p) ? { path: p, search: u.searchParams } : null;
  }

  function externalUrl(raw) {
    if (!raw) return null;
    var base, u;
    try { base = new URL(document.baseURI); u = new URL(raw, document.baseURI); } catch (e) { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.host !== base.host ? u.href : null;
  }

  function statusEl(el) {
    var found = (el.querySelector && el.querySelector("[data-tangent-status]")) ||
      (el.parentNode && el.parentNode.querySelector
        ? el.parentNode.querySelector("[data-tangent-status]") : null) ||
      document.querySelector("[data-tangent-status]");
    if (found) return found;
    var p = document.createElement("p");
    p.setAttribute("data-tangent-status", "");
    p.setAttribute("role", "status");
    p.setAttribute("aria-live", "polite");
    if (el.insertAdjacentElement) el.insertAdjacentElement("afterend", p);
    else if (el.parentNode) el.parentNode.appendChild(p);
    return p;
  }

  function setBusy(el, busy) {
    if (el.tagName === "FORM") {
      el.setAttribute("aria-busy", busy ? "true" : "false");
      var controls = el.querySelectorAll('button, input[type="submit"]');
      for (var i = 0; i < controls.length; i++) controls[i].disabled = busy;
    } else {
      el.setAttribute("aria-disabled", busy ? "true" : "false");
      el.style.pointerEvents = busy ? "none" : "";
    }
  }

  function finish(el, status, ok) {
    setBusy(el, false);
    el.setAttribute("data-tangent-state", ok ? "success" : "error");
    status.textContent = ok
      ? (status.getAttribute("data-success") || "Sent — watch the session for the reply.")
      : (status.getAttribute("data-error") || "Couldn't send just now — please try again.");
  }

  function fireCallback(el, path, body) {
    var status = statusEl(el);
    setBusy(el, true);
    el.setAttribute("data-tangent-state", "submitting");
    status.textContent = "Sending\\u2026";

    if (!framed) {
      setBusy(el, false);
      el.setAttribute("data-tangent-state", "");
      status.textContent = "Open this page from the session to submit.";
      return;
    }

    var requestId = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(16).slice(2);
    var done = false;
    function settle(ok) {
      if (done) return;
      done = true;
      window.removeEventListener("message", onResult);
      finish(el, status, ok);
    }
    function onResult(e) {
      var d = e.data;
      if (!d || d.type !== "tangent:callback:result" || d.requestId !== requestId) return;
      settle(!!d.ok);
    }
    window.addEventListener("message", onResult);
    setTimeout(function () { settle(false); }, 15000);
    window.parent.postMessage(
      { type: "tangent:callback", requestId: requestId, path: path, body: body },
      "*"
    );
  }

  function searchBody(search) {
    var body = {};
    search.forEach(function (value, key) { body[key] = value; });
    return body;
  }

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || form.tagName !== "FORM") return;
    var cb = callbackOf(form.action);
    if (!cb) return;
    event.preventDefault();
    var body = searchBody(cb.search);
    new FormData(form).forEach(function (value, key) {
      if (typeof value === "string") body[key] = value;
    });
    fireCallback(form, cb.path, body);
  }, true);

  document.addEventListener("click", function (event) {
    var a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href");

    var cb = callbackOf(href);
    if (cb) {
      event.preventDefault();
      fireCallback(a, cb.path, searchBody(cb.search));
      return;
    }

    var ext = externalUrl(href);
    if (ext && framed) {
      event.preventDefault();
      window.parent.postMessage({ type: "tangent:openUrl", url: ext }, "*");
    }
  }, true);
})();
`.trim();

const BRIDGE_MARKER = "data-tangent-page-bridge";

/**
 * Inserts the bridge client into an HTML document, before `</head>` when present
 * (else `</body>`, else prepended). Idempotent — a document already carrying the
 * bridge is returned unchanged.
 */
export function injectPageBridge(html: string): string {
  if (html.includes(BRIDGE_MARKER)) return html;
  const tag = `<script ${BRIDGE_MARKER}>\n${PAGE_BRIDGE_CLIENT}\n</script>`;

  const head = html.search(/<\/head\s*>/i);
  if (head !== -1) return html.slice(0, head) + tag + html.slice(head);

  const body = html.search(/<\/body\s*>/i);
  if (body !== -1) return html.slice(0, body) + tag + html.slice(body);

  return tag + html;
}
