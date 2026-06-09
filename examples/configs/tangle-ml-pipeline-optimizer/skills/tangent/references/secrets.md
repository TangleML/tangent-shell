# Secrets & Credentials in Tangle Pipelines

Tangle has first-class secret management. Use it. **Never** inline an API key,
token, password, OAuth client secret, service-account key, ejson value, or any
other credential into a pipeline YAML, an Oasis input field, a component
argument default, or a config file you submit.

This is a hard rule, not a soft preference. Pipeline YAML and pipeline-run
arguments are stored in plaintext in the Tangle backend, surface in Oasis run
detail pages, get copied by `tangle-deploy pipeline-run export`, get logged by
the runner, and end up in agent transcripts. A raw key pasted into an input
node *is a leaked credential*.

## The rule

When a pipeline needs a credential (API key, bearer token, OAuth secret, HF
token, GCS/BQ service-account JSON, Slack bot key, Comet API key, etc.):

1. **Do not read the raw value yourself.** Do not paste it from
   `Shopify/discovery`, `tangle-secrets-*.ejson`, GCP Secret Manager,
   `gcloud secrets versions access`, env vars, browser sessions, Slack, vault,
   or anywhere else into the pipeline. Even if you can see it, treat it as
   poison.
2. **Use a Tangle secret reference instead.** Components consume the secret
   via `dynamicData.secret.name` in the pipeline YAML; Tangle resolves the
   value at task-launch time, inside the container, with no plaintext on the
   pipeline spec.
3. **The human creates / rotates the secret value**, via `tangle-deploy
   secrets create ... --from-env VAR_NAME` (preferred — agent never touches
   the value) or via the Oasis UI secrets settings page. The agent's job is
   to identify *that a secret is needed*, *what to name it*, and *how to wire
   it through the pipeline*. Not to source the value.

If the credential is missing from the user's Tangle account, **stop and ask**.
Do not "temporarily" inline a value to unblock yourself.

## When does the agent halt? (UX model)

The agent does **not** halt mid-construction every time it sees a credential
argument. That would make scaffolding LLM/API pipelines miserable and would
break `tangent auto` outright. The actual halt boundary is at *submission*,
not at authoring. Concretely:

| Stage | What the agent does | Halt? |
|---|---|---|
| 1. Detect a secret is needed | Detection heuristics match (`*_KEY`, `*_TOKEN`, `dynamicData.secret`-typed input, GCP Secret Manager input, etc.) | No — proceed |
| 2. Wire it into the pipeline YAML | Pattern A: `dynamicData.secret: { name: "X" }`. Pattern B: plain string `gcp_secret_name: "X"`. **Never the value.** | No — proceed |
| 3. Validate the pipeline | `tangle-deploy pipeline-run validate` — passes without the value (it only checks structure) | No — proceed |
| 4. **Submission boundary** | Run the pre-submit credential-grep guard from [`step-3-submit.md`](step-3-submit.md). If the referenced secret doesn't yet exist under the running account, surface a copy-pasteable `tangle-deploy secrets create --from-env` command for the human. | **Yes** — hard halt until the human confirms the secret exists |
| 5. After human creates the secret | Resume: `pipeline-run submit ... --hydrate --no-wait` | — |

The agent's job at construction time is to produce a complete, reviewable
artifact (pipeline YAML + scaffolding + a list of exactly which secrets the
human still needs to create). The agent's job at submit time is to refuse to
submit if any credential value is inlined or any referenced secret is missing.

### Why halt at submit, not construction?

- **Validation doesn't need the value.** A pipeline file with
  `dynamicData.secret: { name: "FOO" }` validates and is safe to share,
  commit to a repo, paste in Slack. The leak risk only materializes when a
  *value* enters the pipeline spec or run arguments — which only happens at
  submit.
- **The human gets a full artifact to review.** Half-finished scaffolds plus
  an interactive prompt are worse UX than a complete pipeline plus a clear
  "run this command before submitting" handoff.
- **`tangent auto` would deadlock otherwise.** The autonomous loop runs
  unsupervised; halting on every credential reference per round means no
  LLM-using scenario ever advances past round 1.

### When the agent *should* halt during construction

One legitimate construction-time halt: when the agent doesn't know the
correct secret *name* and would have to guess. Identifier names are not
credentials — inlining `gcp_secret_name: "shopify-openai-proxy-key"` is
safe even if the name is wrong — but a wrong name causes a runtime
"secret not found" failure that wastes the user's time and budget.

- **Interactive session** (human in the loop, e.g. running `tangent builder`,
  `tangent new-scenario`, or a one-off prompt): if the secret name is not
  given by the user and not unambiguously derivable, **halt and ask**. Do
  not guess identifier names from your training data, from grepping the
  monorepo, or from `gcloud secrets list`.
- **Autonomous session** (`tangent auto` mid-loop): do not halt mid-round.
  Use an explicit placeholder like `"REPLACE_ME_<input_name>"` and let the
  submit-time gate catch it. The gate fails fast and surfaces the unmet
  prerequisite; this is preferable to a hung loop.

Distinguish the two by checking `MEMORY.md`'s active-runs state, the
presence of `scenario.yaml`, and whether the entry point was `tangent auto`
vs a one-shot prompt. When in doubt: ask.

### What "halt and ask" looks like in practice

Good:

> I'm wiring a `Run llm on rows` task and it needs `gcp_secret_name` and
> `gcp_secret_project` (these are *identifiers* the component uses to fetch
> the API key from GCP Secret Manager at runtime — not the key value itself).
>
> What name + project should I use? If you don't have one yet, you'll need to
> create the GCP Secret Manager entry under a project your pipeline's runtime
> service account can read from, then tell me the name and project.
>
> I'll wait — I won't guess.

Bad (do not do):

> I found `LLM_PROXY_API_KEY` in `Shopify/discovery` — using that. (❌ sourcing)
> I'll default `gcp_secret_name` to `shopify-openai-proxy-key`. (❌ guessing)
> Pasting the API key value as `constantValue` for now — you can rotate later.
> (❌ **never**)

## Detection — when does this rule fire?

If an input/argument is described as, named like, or behaves like any of:

- `*_API_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_KEY`, `bearer`,
  `authorization`, `client_secret`, `private_key`, `webhook_signing_secret`
- A header value containing `Bearer …`, `Basic …`, or `Authorization: …`
- An HF token, OpenAI/Anthropic/Google/proxy.shopify.ai key, Comet API key,
  Slack bot token (`xoxb-…`), GitHub PAT, GCP service-account JSON,
  Cloudsmith token, ejson-encrypted value
- Anything the source repo reads from `os.environ`, `ejson`, Secret Manager,
  or `dynamicData.secret` itself

…then it is a secret. Route it through `dynamicData.secret`.

## The end-to-end workflow

### 1. Discover what secrets exist

```bash
shadowenv exec -- tangle-deploy secrets list
```

Output lists `secret_name`, `updated_at`, optional `expires_at`, optional
`description`. The secret **value is never returned** — by Tangle or by you.

Secrets are **account-scoped** — they belong to whoever created them. If the
pipeline will run under a service account (e.g. scheduled via
`tangle-deploy pipeline schedule`), the secret must exist under *that* SA's
account, not the human's. See [Account scoping](#account-scoping) below.

### 2. If the secret is missing, ask the human to create it

Surface a concrete command for the human to run. Use `--from-env` so the
value never enters the pipeline YAML or your context — **but be careful
about how the env var itself is set**, because a naive `export VAR='value'`
is recorded verbatim in shell history (`~/.bash_history`, `~/.zsh_history`)
and any terminal recording / session capture.

The safe pattern is `read -rs` (silent read from stdin, never echoed,
never stored in history):

```bash
# Human runs these — agent does not source MY_API_KEY itself.
# `read -rs` reads stdin silently; the value is never echoed and never
# enters shell history (only `read -rs MY_API_KEY` is recorded, not the value).
read -rs MY_API_KEY              # paste the value, press Enter (no echo)
export MY_API_KEY
shadowenv exec -- tangle-deploy secrets create MY_API_KEY \
  --from-env MY_API_KEY \
  --description 'Used by <pipeline> for <purpose>'
unset MY_API_KEY                  # clear it from the current shell
```

**Anti-pattern — do not propose this form**:
```bash
export MY_API_KEY='…paste value here…'   # ❌ value lands in shell history
```
Even with `HISTCONTROL=ignorespace` (prepend a space) or `set +o history`,
relying on a per-shell config is fragile. `read -rs` works the same way
everywhere and is the recommended form.

Multi-secret batch (`secrets_config.yaml`):

```yaml
_defaults:
  description: "Managed for <pipeline> via tangent"
configs:
  - secret_name: OPENAI_API_KEY
    from_env: OPENAI_API_KEY
  - secret_name: HF_TOKEN
    from_env: HF_TOKEN
```

```bash
shadowenv exec -- tangle-deploy secrets create --config secrets_config.yaml
```

**Do NOT** propose `tangle-deploy secrets create NAME --value 'sk-…'` with a
value you pulled from somewhere. The `--value` flag exists for humans typing
at a prompt, not for agents shuffling credentials between systems.

### 3. Wire the secret into the pipeline YAML

On the component argument that consumes the credential, replace the literal
value with a `dynamicData.secret` reference. The `name` must match exactly
what `tangle-deploy secrets list` shows (case- and space-sensitive):

```yaml
tasks:
  call_llm:
    componentRef:
      name: "LLM Inference"
    arguments:
      prompt:
        taskOutput:
          taskId: build_prompt
          outputName: prompt
      api_key:
        dynamicData:
          secret:
            name: "OPENAI_API_KEY"   # ← exactly as listed by `tangle-deploy secrets list`
      base_url:
        constantValue: "https://proxy.shopify.ai/v1"
```

Things to verify after wiring:

- `tangle-deploy pipeline-run validate <pipeline.yaml>` passes.
- Run the **complete 4-stage pre-submit gate** from
  [`step-3-submit.md`](step-3-submit.md) § "Pre-submit checks". The gate
  uses `grep -lEi` (filenames only, never echoes matching lines) plus a
  placeholder scan and a Tangle-secret existence check. **Do not** invent
  ad-hoc verification commands like `grep -E '(sk-|Bearer |...)' file` —
  that variant prints the matching line to stdout, which re-leaks the value
  into your terminal, agent transcript, and shell history. Always use the
  `-lE` form (or open the file in an editor) when checking for credential
  shapes.
- The argument is NOT also set elsewhere (e.g. in the run config file passed
  via `-f`) with a literal value. CLI/config args override `dynamicData` at
  some call sites; double-check the effective value.

### 4. Author the component to consume the secret

If you're also writing the component code, accept the secret as a regular
string argument and **degrade gracefully when unset** — the component should
not crash if Tangle resolves the secret to empty (e.g. the secret was
deleted, or a teammate runs the pipeline under an account that doesn't have
it):

```python
def call_llm(prompt: str, api_key: str = "", base_url: str = "") -> dict:
    if not api_key:
        raise ValueError(
            "Missing api_key. Create the Tangle secret and reference it via "
            "dynamicData.secret on this argument."
        )
    ...
```

Don't log the value. Don't echo it back as an output. Don't write it to an
artifact.

## Pattern B — component fetches from GCP Secret Manager itself

Some components don't take the credential as input at all — they take a
**GCP Secret Manager name + project** as plain string inputs, then call
the Secret Manager API themselves at runtime using the pipeline's service
account. Example: the `Run llm on rows` component (digest
`2d08f7a5...`) has inputs:

- `gcp_secret_name: str` — e.g. `"LLM_PROXY_API_KEY"`
- `gcp_secret_project: str` — e.g. `"shopify-discovery-relevance"`

**These are identifiers, not credential values.** Inlining them as plain
string `arguments:` is correct and safe:

```yaml
run_llm:
  componentRef: { digest: 2d08f7a5... }
  arguments:
    model: "gpt-4o-mini"
    gcp_secret_name: "LLM_PROXY_API_KEY"      # name, NOT value
    gcp_secret_project: "my-gcp-project"      # project id, NOT value
```

**Rules for this pattern:**

1. The agent provides only the NAME and PROJECT. Never run
   `gcloud secrets versions access NAME` to fetch the underlying value,
   and never paste that value anywhere. The component fetches it itself
   at task-launch time, inside the container, using the runtime SA's
   `roles/secretmanager.secretAccessor`.
2. If you don't know the right name/project, **ask the human**. Don't
   guess by grepping `Shopify/discovery` or running `gcloud secrets list`
   and picking one that looks right — you'll either pick wrong (wrong
   project, wrong rotation, wrong scope) or accidentally surface a name
   that probes a secret the requester shouldn't be using.
3. If the human's runtime SA doesn't yet have `secretAccessor` on the
   secret, surface a `gcloud secrets add-iam-policy-binding` command for
   them to run — don't bind it yourself unless explicitly asked.
4. The credential-shape grep guard from
   [`step-3-submit.md`](step-3-submit.md) won't flag identifier strings
   like `LLM_PROXY_API_KEY` (they're not high-entropy token bodies), so
   the rule is enforced by the agent's discipline here, not by a script.

Which pattern to use depends on the component, not on agent preference.
Inspect the component (`tangle-deploy component inspect --name ...
--full-spec`) to see whether it takes the credential as a `dynamicData`
-bound input (Pattern A) or fetches via Secret Manager itself (Pattern B).

## Account scoping

Secrets in Tangle belong to the authenticated account that created them.
Three common cases:

| Run-as identity | Where to create the secret |
|---|---|
| Your personal `@shopify.com` account | `tangle-deploy secrets create …` with default auth |
| A service account (scheduled pipelines, Cloud Run, CI) | Impersonate the SA first, then create the secret as that SA |
| River session (`river-sandbox@shopify-river-forge.iam.gserviceaccount.com`) | River's own credentials proxy — secrets live under the `river-session` identity |

To create or rotate a secret under a service account from a human shell,
**use impersonation — never mint a long-lived JSON key.** A downloaded
`keys.json` is a long-lived credential that survives `rm` / `shred`: the
local file is gone, but the IAM key in GCP is still valid until you
explicitly revoke it (`gcloud iam service-accounts keys delete`). The
impersonation flow below leaves no on-disk key and no shell-history
leak, and aligns with the existing Tangent auth-wizard guidance:

```bash
# 1. Verify you have roles/iam.serviceAccountTokenCreator on the SA
#    (the auth-wizard skill can grant this if you don't):
shadowenv exec -- tangle-deploy auth setup-sa grant-user-access \
  my-runner@my-project.iam.gserviceaccount.com -u "$(gcloud config get-value account)"

# 2. Impersonate for this shell only — no key file, no shell-history leak.
#    --impersonate-service-account makes gcloud / TangleApiClient mint a
#    short-lived (1h) access token on demand; nothing persists on disk.
export CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT=my-runner@my-project.iam.gserviceaccount.com

# 3. Read the secret value silently (never enters shell history).
read -rs MY_API_KEY
export MY_API_KEY

# 4. Create/rotate the secret — tangle-deploy uses the impersonated identity.
shadowenv exec -- tangle-deploy secrets create MY_API_KEY --from-env MY_API_KEY

# 5. Tear down the impersonation + clear the value from this shell.
unset CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT MY_API_KEY
```

**Why not `gcloud iam service-accounts keys create`?** That command mints a
long-lived private key (no expiry by default), which is itself a
high-value credential. `shred -u /tmp/sa.json` only removes the on-disk
copy; the IAM key remains valid until manually revoked, and any copy of
that file that escaped your machine (backup, swap, terminal recording,
agent transcript) is now a persistent leak. Impersonation gives you the
same access with no minted key and a one-hour TTL on the tokens you do
use. If you absolutely must use a key file (e.g. running outside gcloud's
auth environment), set a short `--key-file-expiration` and revoke it
explicitly with `gcloud iam service-accounts keys delete` when you're
done — do not rely on `shred`.

For the same reason, **never** `export TANGLE_AUTH='…value…'` literally
in the shell — that lands in `~/.bash_history` / `~/.zsh_history`. If you
need `TANGLE_AUTH` for a one-off command, source it via `read -rs` the
same way as `MY_API_KEY` above.

If a scheduled run fails with a "secret not found" or empty-value error, the
first thing to check is *whose* account holds the secret. Symptom: pipeline
works when you submit it manually but fails the moment Cloud Scheduler
triggers it under the SA.

## Anti-patterns — refuse all of these

- "I'll just paste the value into the input box on the Oasis run page so the
  pipeline can pick it up." ❌ The value is now in the run spec, visible in
  Oasis run details, exported by `pipeline-run export`, and copied by clones.
- "I'll set the value as a `constantValue:` on the argument, since it's just
  a one-off run." ❌ Same as above — `constantValue` is plaintext.
- "I'll bake it into the component's Docker image / a config file embedded in
  the image." ❌ The image is mirrored, cached, and pullable by anyone with
  registry read.
- "I'll put it in the run config file passed via `-f`." ❌ The config file is
  uploaded with the run and stored alongside the pipeline spec.
- "I'll add it as a `cli_args:` value on a downstream task." ❌ Treated as
  pipeline arguments — same plaintext exposure.
- "It's only the staging key, so it's fine." ❌ Staging keys are still
  credentials. Use a secret.
- "I'll create the secret with `--value` using the key I just read from
  ejson." Partial credit — the secret reference is right, but you've now
  written the plaintext into shell history and possibly logs. Use
  `--from-env` and have the human export the var.

## Working example

River built `secrets_demo_pipeline.yaml` to demonstrate the end-to-end flow
against `httpbin.org/bearer`:

```bash
# 1. Create the secret (human runs this — DEMO_BEARER_TOKEN can be any string)
shadowenv exec -- tangle-deploy secrets create DEMO_BEARER_TOKEN \
  --value 'anything' --description 'demo'

# 2. Submit — the pipeline references DEMO_BEARER_TOKEN via dynamicData.secret
shadowenv exec -- tangle-deploy pipeline-run submit secrets_demo_pipeline.yaml \
  -f secrets_demo_pipeline.config.yaml --hydrate --no-wait

# 3. Cleanup
shadowenv exec -- tangle-deploy secrets delete DEMO_BEARER_TOKEN
```

The pipeline injects the secret as `Authorization: Bearer <value>` to
`httpbin.org/bearer`, and a second task confirms the auth header round-tripped
correctly. Inspect that pipeline YAML for the canonical `dynamicData.secret`
shape.

## CLI reference

```bash
shadowenv exec -- tangle-deploy secrets list
shadowenv exec -- tangle-deploy secrets create NAME --from-env ENV_VAR \
    [--description '…'] [--expires-at 2026-12-31T00:00:00Z]
shadowenv exec -- tangle-deploy secrets update NAME --from-env ENV_VAR
shadowenv exec -- tangle-deploy secrets delete NAME [--force]
shadowenv exec -- tangle-deploy secrets --help-full
```

All `tangle-deploy secrets` subcommands accept `--config / -f` for multi-secret
config files (see `_defaults` / `configs` block above).

## When in doubt

Stop and ask the human. "This pipeline needs an `X_API_KEY` — please create
a Tangle secret named `<NAME>` (`tangle-deploy secrets create <NAME>
--from-env <NAME>`) and confirm before I wire it through" is always the
right move. Never the wrong move.
