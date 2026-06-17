---
name: reproduce-research
description: Reproduce a research paper / white paper / arXiv result as a Tangle pipeline. Use when the user asks to "reproduce", "replicate", or "implement" a paper, benchmark, or arXiv link as an experiment.
allowed-tools: [Bash, Read, Write, Glob, Grep, Agent, dispatch]
---

# Reproduce Research

Reproduce a published result — a paper, white paper, arXiv link, or benchmark —
as a real, multi-step Tangle pipeline. The deliverable is a pipeline whose DAG
visibly mirrors the experiment (data prep → method → baseline → evaluation →
plots → report), submitted via the Tangle CLI, with the headline claim
quantified.

## When to use

Trigger this skill when the user asks to **reproduce**, **replicate**, or
**implement** any of:

- A paper or white paper ("reproduce the RaBitQ paper", "replicate Table 3").
- An arXiv link or DOI ("turn https://arxiv.org/abs/... into a Tangle run").
- A benchmark or published result ("reproduce SIFT1M Recall@k vs QPS").

For lightweight "what does this paper say?" questions, just answer. This skill is
for building and submitting the reproduction as a Tangle experiment.

If any Tangle terminology is unclear, use the `tangle-help` skill to clarify
**before** proceeding — do not guess at platform concepts.

## Core orchestration rules

**Prime is the coordinator and runs this flow itself.** Do NOT delegate the whole
flow to a single worker that "does everything" — that worker will skip the safety
monitor. Prime spawns *separate, scoped* subagents (safety-monitor, design,
builder) and tracks them. Prime does not build or submit directly unless
recovering from a failed or non-responsive subagent.

### Startup sequence (do this in order)

**Step 0 — Safety monitor (blocking gate).** Before spawning the Design subagent
or any long-running work, create the 1-minute safety trigger and its dedicated
`safety-monitor` subagent — see
[Safety monitor](#safety-monitor--pipeline-status-watch). Confirm it is live.
**Do not proceed to Phase 1 until this gate passes:**

```
[ ] safety trigger created (every 1 min)
[ ] safety-monitor subagent live
--> only then spawn the Design subagent
```

If you ever notice the monitor is missing, STOP and create it before continuing.

**Step 1+ — Phases.** Then run the two phases in order: **Design** first, then
**Builder**. They are separate subagents — the design subagent never builds or
submits.

### Ongoing rules

1. **No manual polling.** Do NOT use a `sleep -> read room transcript` loop. Rely
   on subagent messages plus the safety trigger.
2. **Don't rush the builder.** Safety alerts are informational unless there is
   clear failure or sustained non-response.
3. **Surface artifacts.** Show any user-facing artifact as a clickable Markdown
   link or image, and pin important artifacts.

## Safety monitor / pipeline status watch

This is **Step 0** — Prime creates it first, before Phase 1 and before any other
subagent. If the monitor is missing at any point, Prime stops and creates it
before continuing. Prime creates a safety trigger:

- **Schedule trigger** named for the experiment (e.g. `rabitq-safety-check`),
  firing **every 1 minute**, targeting a dedicated `safety-monitor` subagent —
  **not** Prime. Never replace this with a manual `sleep -> read transcript` loop.

**On every firing the safety monitor:**

1. Reads the recent room transcript and lists active/completed/killed subagents.
2. Detects whether a pipeline was submitted by scanning recent messages for
   `RUN_ID`, `ROOT_EXECUTION_ID`, `PIPELINE_SUBMITTED`,
   `CORRECTED_PIPELINE_SUBMITTED`, or `FIXED_PIPELINE_SUBMITTED`.
3. Tracks the latest **valid** submitted pipeline's `ROOT_EXECUTION_ID` —
   ignoring known-invalid first-pass runs, preferring the newest corrected/fixed
   run.
4. If a valid `ROOT_EXECUTION_ID` is known, checks Tangle execution status (via
   the execution-state/status tool) to classify it as running / succeeded /
   failed / cancelled / ended-with-skipped-tasks.

**Alerting:**

- **Running** — post only a terse status update unless there is a concern.
- **Ended** — alert Prime immediately:
  - Success: `PIPELINE_ENDED_SUCCESS` + run id, root execution id, confirmation
    all expected DAG tasks succeeded, and an instruction to Prime to list/fetch
    output artifacts and present final links/curve/report.
  - Failure: `PIPELINE_ENDED_FAILURE` + run id, root execution id, failed task
    name + execution id (if known), skipped task count, an error/log excerpt (if
    available), and an instruction to Prime to inspect failed task logs and route
    a focused fix to builder/debugger.
- **Non-response** — alert Prime that a builder/debugger is non-responsive only
  after sustained silence or a missed required milestone. Do not repeatedly
  pressure or restart builders during expected long build/validation work.
  Otherwise alerts are informational unless a pipeline ended, a milestone was
  missed, no progress was reported for an unusually long time, or the user asks.

**Prime behavior after an alert:**

- **Success** — list artifacts for the final execution and fetch/pin/present
  them: `metrics_csv`, `recall_qps_curve_png`, `recall_qps_curve_svg`,
  `summary_md`/`summary_html`, `repro_manifest`.
- **Failure** — inspect failed task logs, identify the root cause, ask
  builder/debugger for a targeted fix, keep the approved multi-step DAG intact,
  and submit a corrected retry only after validate/hydrate succeeds.
- **Running** — do not spam the user; rely on the live progress widget and terse
  monitor alerts only when useful.

## PHASE 1 — Design subagent

Delegate to one subagent. It must NOT build or submit anything. Its job is to
turn the paper into an approved plan.

Tasks:

1. Understand the assignment and split it into concrete steps.
2. Find/download the paper PDF (arXiv, DOI, or provided URL) if available. Copy
   it to `artifacts/`, pin it, and notify Prime with the artifact path.
3. Design a **multi-step** Tangle pipeline using lightweight Python components.
4. Render the design as an image artifact under `artifacts/` and pin it.
5. Write a design doc under `artifacts/` and pin it — use
   [`references/design-doc-template.md`](references/design-doc-template.md).
6. Hand off a concise implementation brief for the builder — use
   [`references/builder-brief-template.md`](references/builder-brief-template.md).

The final design reply MUST include:

- `DESIGN_READY`
- PDF status/path
- design image path (the pinned artifact under `artifacts/`)
- design doc path
- builder brief (or its path)

### The DAG must be visibly multi-step, not monolithic

Decompose the experiment into a real DAG with wired artifacts. A single
"benchmark" task is **incorrect** even if it validates and submits. Use this
reusable seven-stage pattern and instantiate it for the specific paper:

| Stage | Generic task | Purpose |
|---|---|---|
| 1 | `prepare_dataset` | Download/verify the dataset; emit a dataset manifest. |
| 2 | `build_shared_artifacts` | Train/build anything reused by every method (e.g. a shared quantizer, tokenizer, splits). |
| 3 | `build_method_under_test` | Build the paper's method on the shared artifacts. |
| 4 | `build_baseline` | Build the comparison baseline on the same shared artifacts. |
| 5 | `evaluate_sweep` | Sweep the relevant parameter grid; emit per-item metrics. |
| 6 | `plot_results` | Produce the paper's headline curve/figure(s). |
| 7 | `write_report` | Synthesize manifests + metrics + plots into a summary + repro manifest. |

Stages 2-4 may collapse or expand to match the paper (some papers have no shared
artifact; some compare three methods). Keep at least: dataset → method →
baseline → evaluation → plots → report.

Wire outputs explicitly between stages, e.g.:

- dataset → shared artifacts
- dataset + shared → method-under-test
- dataset + shared → baseline
- dataset + shared + method + baseline → evaluation
- evaluation → plots
- manifests + metrics + plots → report

**Worked example (RaBitQ on SIFT1M):** the seven tasks instantiate as
`prepare_sift1m_dataset`, `build_shared_ivf` (shared IVF quantizer, `nlist=4096`),
`build_rabitq_index` (`Bq=4`, `epsilon0=1.9`), `build_pq_index` (`M=64`,
`nbits=4`, rerank budgets `[500,1000,2500]`), `evaluate_ann_sweep`
(`nprobe=[1,2,4,8,16,32,64,128]`, Recall@{1,10,100} vs QPS, one query at a time),
`plot_recall_qps`, `write_experiment_report`. See
[`../../ui/reproduce-research-doc.md`](../../ui/reproduce-research-doc.md) for the
full worked prompt this skill generalizes.

Before starting the builder phase, Prime presents the design image to the user
under the heading/text "For your information", showing it **both ways**:

- **As an inline image** — embed it with Markdown image syntax so it renders in
  the chat: `![Design](<design-image-path-or-url>)`.
- **As an artifact link** — also provide a clickable Markdown link to the pinned
  artifact: `[Design diagram](<design-image-path-or-url>)`.

Use the artifact's signed URL or local artifact path so both the inline render
and the link resolve.

## PHASE 2 — Builder subagent

After `DESIGN_READY`, delegate to a **separate** subagent explicitly instructed
to operate as `tangent builder`.

1. Read and follow [`../tangent/agents/builder.md`](../tangent/agents/builder.md)
   and its required references (canonical from-scratch experiment pipeline and
   Tangle CLI submission rules).
2. Use `shadowenv exec -- tangle-deploy`; do NOT use API/MCP submit tools.
3. Set the source annotation before any submit:
   ```bash
   export TANGLE_DEPLOY_SOURCE=$([ -n "$RIVER_SESSION_JWT" ] && echo "river-tangent" || echo "tangent")
   ```
4. Build under an inferred workspace, e.g. `tangent-work/<paper-slug>/`.
5. Strictly implement the approved DAG. Do NOT collapse it into one task — a
   monolithic task is incorrect even if it validates/submits.
6. Use lightweight Python components, preferably separate component YAML/source
   per step. At minimum the Tangle UI DAG must visibly show every required task
   and its artifact wiring.
7. Wire task outputs exactly as the design specifies. Reuse code only if it is
   split across the correct task boundaries.

### Builder reply contracts (do not go silent)

Report milestone progress. Long-running work is fine; silence is not.

1. `BUILDER_STARTED` — workspace, files found/reused, immediate plan, whether
   Prime intervention is needed.
2. `FILES_CREATED` — all component source paths, all component YAML paths,
   pipeline path, config path, task list.
3. `CORRECTED_DAG_READY` — pipeline path, config path, exact tasks present,
   artifact wiring summary, confirmation: "not monolithic".
4. `VALIDATION_STATUS` — commands run, success/failure output, hydrated pipeline
   path.
5. Submit with `--no-wait` only after `CORRECTED_DAG_READY` and validation
   success.
6. `PIPELINE_SUBMITTED` — pipeline path, config path, RUN_ID, ROOT_EXECUTION_ID
   (if available), production Oasis URL, source annotation.
7. `SUBMISSION_FAILED` (on failure) — exact command, exact error, files
   involved, next fix.

## Reproducibility checklist

Bake these into the design and the builder's components so results are
trustworthy:

- **Dataset**: prefer a standard public source; record URI, expected files, and
  checksums in the dataset manifest.
- **Single-threaded CPU** (when comparing throughput/latency): set
  `OMP_NUM_THREADS=1`, `MKL_NUM_THREADS=1`, `OPENBLAS_NUM_THREADS=1`,
  `BLIS_NUM_THREADS=1`, `VECLIB_MAXIMUM_THREADS=1`, `NUMEXPR_NUM_THREADS=1`, and
  call `faiss.omp_set_num_threads(1)` if using Faiss.
- **In-memory** search/evaluation; keep raw inputs available for exact rerank /
  ground-truth where the method needs it.
- **No batched timing** for throughput metrics (e.g. QPS) — process items one at
  a time during timed evaluation.
- **Record repro metadata**: library versions, CPU/thread settings, full config,
  seeds, and caveats (note any approximations where an exact author
  implementation was unavailable).

## Dataset accessibility / ingestion

A dataset URL reachable from the local dev environment is **not** guaranteed to
be reachable from inside a Tangle container. Validate dataset access for the
actual runtime path, or make ingestion robust with fallbacks.

- **Never hard-pin a single untested public URL.** Bare
  `urllib.request.urlretrieve` from Tangle often hits `HTTP 403 Forbidden`
  (e.g. `https://ann-benchmarks.com/sift-128-euclidean.hdf5`). The run config
  must instead either set `dataset_uri: "auto"` with fallbacks, use a verified
  accessible `gs://`/data-source URI, or document why the chosen source works in
  Tangle.
- **Default to `dataset_uri: "auto"` with ordered fallbacks** in the prepare
  task. For SIFT1M: try the TexMex archive
  (`ftp://ftp.irisa.fr/local/texmex/corpus/sift.tar.gz`) first, then
  ANN-Benchmarks HDF5 with browser-style request headers / User-Agent, then an
  optional user-provided `gs://` URI.
- **The downloader must** support `ftp://`, `http(s)://`, `gs://`, local paths,
  `.tar.gz`, `.hdf5/.h5`, and extracted TexMex dirs; use browser-style headers
  for HTTP(S); log which source was attempted/selected and why; fail with a clear
  error listing every attempted URI and exception; and record the selected
  source in `dataset_manifest.json`.
- **Probe before the full run.** A local probe is useful but not sufficient. If
  Tangle runtime access is uncertain, first validate/submit a tiny prepare-only
  smoke config or use a known-accessible `gs://` mirror. Do not start expensive
  indexing until dataset preparation is proven accessible.
- **If prepare fails, fix ingestion first** — do not debug downstream tasks.
  Diagnose the prepare task logs, fix the downloader, regenerate affected
  component YAMLs, validate/hydrate, and resubmit the same multi-step DAG.

## Prime final reporting

When a real root execution id is available, emit exactly one progress widget:

````
```tangent-ui:pipeline-progress
{ "executionId": "<ROOT_EXECUTION_ID>" }
```
````

Use the real execution id; emit the block once per execution.
