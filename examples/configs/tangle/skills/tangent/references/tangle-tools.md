# Tangle CLI Reference

**Always use the tangle CLI commands via Bash. Do NOT use
tangle-deploy MCP tools (`mcp__tangle-deploy__*`) even if they are available.**

**Do not rely on a static list of commands.** The `tangle-deploy` package is
updated frequently with new commands and flags.

## Install / Upgrade

Before first use each session, ensure `tangle-deploy` is up to date:

```bash
shadowenv exec -- uv sync --upgrade-package tangle-deploy
```

## Discover Available Commands

```bash
shadowenv exec -- tangle-deploy quickstart
```

This prints every command with a one-line description, organized by group. Use it at the
start of every session to learn what's available.

## Get Help on a Specific Command

```bash
shadowenv exec -- tangle-deploy <group> <command> --help           # basic usage
shadowenv exec -- tangle-deploy <group> <command> --help-extended   # detailed parameter descriptions
shadowenv exec -- tangle-deploy <group> <command> --help-full       # full README with examples
```

## Browse Documentation Topics

```bash
shadowenv exec -- tangle-deploy docs                         # list available topics
shadowenv exec -- tangle-deploy docs <topic>          # read a specific topic
```

## Running Commands

The unified CLI is `tangle-deploy` with subcommand groups. All commands run via `shadowenv exec --`:

```bash
shadowenv exec -- tangle-deploy pipeline-run submit pipeline.yaml -f config.yaml --hydrate --no-wait
shadowenv exec -- tangle-deploy pipeline-run details RUN_ID --state
```

## Submission Rules (applies to ALL pipelines, ALL agents)

Every `pipeline-run submit` MUST follow these three rules:

### 1. Dehydration check

Before submitting, verify the YAML is dehydrated:

```bash
if grep -q '  spec:' <pipeline.yaml>; then
  echo "ERROR: pipeline has inline specs — dehydrate first"
  tangle-deploy pipeline dehydrate <pipeline.yaml> <pipeline.yaml>
fi
```

### 2. Always pass `--hydrate --no-wait`

### 3. Source attribution + `tangent` annotation

Every `pipeline-run submit` writes a `source` annotation on the run, controlled by
the `TANGLE_DEPLOY_SOURCE` env var (precedence: `--source` flag > env var > literal
`"tangle-deploy"` default). **Confirm `TANGLE_DEPLOY_SOURCE` is set per
`references/setup.md` before submitting.** Standard values:

- `river-tangent` — when `RIVER_SESSION_JWT` is set (River agent).
- `tangent` — otherwise (human / Pi / CLI).

Do **not** pass `--source` or override the env var per-run unless you have a
deliberate reason — these standard values are how runs are searchable /
attributable downstream.

In addition to the `source` annotation, **also include the legacy `tangent: "true"`
custom annotation** in the config file passed via `-f` (kept for dashboard /
search backwards-compat):

```yaml
# config.yaml — add to existing args file or create a new one
annotations:
  tangent: "true"
```

Or set after submission:

```bash
tangle-deploy pipeline-run annotations set <RUN_ID> tangent true
```

### Auto-loop annotations (step-3 adds these)

| Key       | Value                        | When         | Source                                          |
| --------- | ---------------------------- | ------------ | ----------------------------------------------- |
| `source`  | `tangent` or `river-tangent` | Every submit | `TANGLE_DEPLOY_SOURCE` env (auto via shadowenv) |
| `tangent` | `"true"`                     | Every submit | Custom annotation in config file                |
| `session` | `YYYY-MM-DD-scenario`        | Auto-loop    | Custom annotation                               |
| `round`   | `"1"`, `"2"`, ...            | Auto-loop    | Custom annotation                               |
| `type`    | experiment type              | Auto-loop    | Custom annotation                               |
| `label`   | short description            | Auto-loop    | Custom annotation                               |

### Canonical submit command

```bash
shadowenv exec -- tangle-deploy pipeline-run submit <pipeline.yaml> \
  -f <config.yaml> --hydrate --no-wait
```

## Checking Run Status (Light vs Heavy)

**Light (~120 tokens)** — use for polling. Returns per-task status counts:

```bash
shadowenv exec -- python3 -c "
from tangle_deploy import TangleApiClient
client = TangleApiClient()
client.set_verbose(False)
run = client.get_pipeline_run('RUN_ID')
state = client.get_execution_graph_state(run.root_execution_id)
print(state.status_totals, 'failed=', state.failed_execution_ids)
"
```

**Heavy (~17K tokens)** — use only after completion, for debugging or extracting execution_ids:

```bash
shadowenv exec -- tangle-deploy pipeline-run details RUN_ID --state
```

## Fetching Container Logs

For application logs (stack traces, code errors):

```bash
shadowenv exec -- tangle-deploy pipeline-run logs EXECUTION_ID
```

**Container logs and K8s events are distinct signals** — you may need both:

- _Container (pod) logs_ = stdout/stderr from the running container. Tangle has
  these; Observe also has them (in `catchall`, filtered by `kube_pod`).
- _K8s events_ = API-server pod-lifecycle events (`Scheduled`, `Pulled`,
  `Started`, `FailedScheduling`, `OOMKilling`, `Evicted`, `Preempted`, …).
  Tangle does **not** have these. They answer "why did the pod disappear?".

`tangle-deploy pipeline-run logs --source observe` will fail in River sessions
with `observe: OBSERVE_AUTH not set` — the tangent zone's shadowenv only issues
`TANGLE_AUTH`, not an Observe token. Use the `observe-data` skill (River-side)
instead; it queries Observe directly via the MCP at
`proxy.shopify.ai/mcp/observe-mcp`.

The handoff is built into the `pipeline-run logs` response. As of
`tangle-deploy >= 0.9.18`, the response includes an `observe_query` field
**whenever container_state can be derived** — even when `OBSERVE_AUTH` is
missing or the Observe call itself errored. Example shape:

```json
{
  "execution_id": "...",
  "container_log_error": "observe: OBSERVE_AUTH not set",
  "observe_query": {
    "pod_name": "task-019dd5daf35f229a49d8-jrwsc",
    "application": "tangle-prod",
    "start_time": "2026-04-28T20:45:00+00:00",
    "end_time": "2026-04-28T20:53:13+00:00"
  }
}
```

**Whenever the response carries `observe_query`, prefer it.** It's the
canonical handoff payload — hand it directly to the `observe-data` skill
rather than re-deriving fields from `details --implementations` or
orchestrator tracebacks.

If the response lacks `observe_query` (older `tangle-deploy`, or no
`container_state` available), fall back to deriving the four fields
(`pod_name`, `namespace`/`application`, `start_time`, `end_time`)
yourself from:

- `tangle-deploy pipeline-run details RUN_ID --execution-id EXEC_ID --implementations`
  (canonical — has the container state's pod_name, namespace, started_at, ended_at), or
- the failed container log's orchestrator traceback (the pod name usually appears,
  e.g. `pods "task-019dd5daf35f229a49d8-jrwsc" not found`).

Both signals (pod logs and K8s events) live in the **`catchall`** dataset on
Observe; use `query_dataset` (or `investigate_api`) with these filter shapes:

_Container (pod) logs:_

```
dataset: catchall
filters:
  kube_pod starts-with <pod_name>
  [application = <namespace>]   # optional, narrows to the right app
time range: <started_at> .. <ended_at>
```

_K8s events for that pod (via the eventbuddy controller):_

```
dataset: catchall
filters:
  kube_namespace        = "system-controllers"
  controller            = "eventbuddy"
  involved-object-name matches-regex <pod_name>
time range: <started_at> .. <ended_at>
```

These mirror the queries `tangle-deploy`'s `log_client._fetch_observe_logs` issues
internally when `OBSERVE_AUTH` _is_ set — you're just running them via River's
Observe MCP instead.

**Nebius caveat:** for Nebius clusters, K8s events bypass eventbuddy and go to
GCP Cloud Logging instead (project `shopify-ml-offline-prod`, log name
`opentelemetry.io/nebius-k8s-logs`, match `jsonPayload.object.regarding.name`
against the pod or Job name). The eventbuddy filter above will return no rows.
River does not have first-class GCP Cloud Logging access today — fall back to
`gcloud logging read` from a shell with the right service account, or escalate.

## Cancelling a Run

```bash
shadowenv exec -- tangle-deploy pipeline-run cancel RUN_ID
```

Or via the Python API:

```bash
shadowenv exec -- python3 -c "from tangle_deploy import TangleApiClient; TangleApiClient().cancel_pipeline_run('RUN_ID')"
```
