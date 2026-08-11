# External session launches

`POST /api/session-launches` is the automation boundary for external systems. It creates
a session from an installed Agent Bundle, persists the supplied prompt as the first human
message, starts Prime, and dispatches the prompt.

The interactive UI continues to use `POST /api/sessions`; keeping the routes separate allows
deployments to apply machine authentication only to the external launch path.

## Request

```http
POST /api/session-launches
Content-Type: application/json

{
  "bundleId": "tangle-oss",
  "prompt": "Investigate the latest failed run"
}
```

Both body fields are required.

## Response

New launch (`201 Created`):

```json
{
  "sessionId": "..."
}
```

The caller can link a user to `/sessions/<sessionId>` on the same Tangent Shell
deployment.

Other responses:

- `400 Bad Request` — malformed body or invalid bundle.
- `404 Not Found` — the requested bundle is not installed.
- `500 Internal Server Error` — an unexpected provisioning failure. Failed launches roll back
  the session database row, agent process, triggers, chat files, and workspace directory.

## Authentication and deployment

Authentication belongs at the ingress or service proxy. Configure the launch path with a
machine-authentication mechanism such as Basic Auth; do not store or compare ingress
credentials in Tangent Shell.

The caller supplies `Authorization: Basic ...` using its provisioned ingress credential,
along with any additional headers required by the hosting environment. Credentials and
related ingress changes belong in deployment configuration, not this application. Because a
browser must not contain a shared machine password, a trusted backend or service shim should
make this request rather than client-side JavaScript calling Tangent Shell directly.
