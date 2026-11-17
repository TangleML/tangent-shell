# Deployment model catalogs

Standalone installations retain existing model/provider settings. Operators may
supply a schema-version-1 catalog through one of:

- `TANGENT_MODEL_CATALOG_FILE`: absolute path to a trusted JSON configuration.
- `TANGENT_MODEL_CATALOG_URL`: trusted HTTPS endpoint (loopback HTTP allowed).
  `TANGENT_MODEL_CATALOG_TOKEN` optionally supplies its bearer credential.

Use only one source. Configured failures fail startup rather than silently
substituting another catalog. Catalog fetches have a ten-second timeout and
cannot redirect credentials. Restart the server to refresh the startup snapshot.
Never put credentials in URLs or catalog JSON.

The server publishes the validated catalog at `/api/config/models` for its
picker, resolves the configured default and replacement IDs, and passes model
data—not fetch credentials—to server and remote local-agent processes. Keep this
endpoint behind the installation's authentication gateway when its catalog is
private. This repo does not contain any deployment's proprietary model list.

Models declare explicit `tangentModelId` (provider/model), protocol, text/image
inputs, token limits, and all Pi thinking-level mappings. A null mapping disables
that level. Protocols supported are Responses, Chat Completions, and Anthropic
Messages. Dedicated provider names avoid replacing built-in provider catalogs.
`browserAvailable: false` marks agent-only choices for browser clients.

Agent inference uses the existing `PI_PROXY_URL` and `PI_PROXY_API_KEY`
configuration. Local hosts must configure their proxy connection and use the
updated host package; an older local-host package will not install catalog model
definitions. Provider paths are protocol-specific relative to that proxy.
Catalog pricing is not part of this contract; runtime cost metadata is unknown
and currently zero-filled, not evidence of free inference.

## Test setup

Start the server with `TANGENT_MODEL_CATALOG_FILE=/absolute/path/models.json`,
or configure the URL and its deployment-managed bearer token. Verify:

1. `/api/config/models` returns the expected version/defaults.
2. The picker shows the catalog choices and supported thinking levels.
3. Starting an agent uses the explicit provider/model selection.
4. A local agent receives the same model definitions with no catalog token.
5. Removing the source configuration restores standalone behavior.

Live streaming/tool-call validation should be performed against the operator's
gateway. Fixture tests only validate registration and configuration delivery.
