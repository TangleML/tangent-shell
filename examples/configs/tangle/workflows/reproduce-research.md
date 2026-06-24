# Reproduce Research

Reproduce a published result — a paper, white paper, arXiv link, DOI, or
benchmark — as a real, multi-step Tangle pipeline. The deliverable is a pipeline
whose DAG visibly mirrors the experiment (data prep → method → baseline →
evaluation → plots → report), submitted via the Tangle CLI, with the headline
claim quantified.

This is an orchestration workflow. **You (Prime) are the coordinator and run this
flow yourself.** Do NOT hand the whole flow to a single worker that "does
everything" — that worker will skip the safety monitor. You stand up the
`safety-monitor` watchdog by creating its trigger (a single `create_trigger`
auto-provisions the trigger-owned watcher — see Step 0; do NOT `spawn_subagent`
for it), then spawn the `designer` and `builder` templates with `spawn_subagent`
and track all of them. You do not build or submit directly unless recovering from
a failed or non-responsive subagent.

If any Tangle terminology is unclear, delegate a docs lookup to the `tangle-help`
skill **before** proceeding — do not guess at platform concepts.

## Use session memory (do this throughout)

You and the safety monitor MUST use session memory as the shared source of truth
— not just transcript scrollback. Record and keep three things current:

- **GOAL** — the paper/claim being reproduced and the success criterion.
- **PLAN** — the approved multi-step DAG and the current phase.
- **CURRENT** — the latest valid `RUN_ID` / `ROOT_EXECUTION_ID`, live run status
  (running / succeeded / failed / cancelled / skipped), the active subagents, and
  the next action.

Write GOAL and PLAN once known, then update CURRENT **frequently** — on every
milestone, every submit/resubmit, and every safety-monitor tick that learns new
live state.

## Startup sequence (do this in order)

**Step 0 — Safety monitor (blocking gate).** Before spawning the designer or any
long-running work:

1. Write GOAL + PLAN to session memory.
2. Create a **schedule trigger** that fires **every 5 minutes**, named for the
   **specific experiment** so it never collides across multiple reproductions in
   one session — use a paper/dataset slug, e.g. `rabitq-sift1m-safety-monitor` or
   `<paper-slug>-safety-monitor`, **not** a generic `safety-monitor`. Target it at
   a dedicated safety-monitor subagent (`target: subagent`, the default) and give
   it an inline `subagent` spec of `{ template: "safety-monitor", name:
"safety-monitor" }`.

   This single `create_trigger` call **auto-provisions** the dedicated watchdog —
   the server spawns the trigger-owned sub-agent eagerly so it exists before the
   first firing, and re-prompts that same agent on every tick. Do **NOT** also
   call `spawn_subagent` for the monitor; that creates a second, unlinked watcher
   that never receives the trigger. The `safety-monitor` template carries the live
   status tool set (`read_room`, `list_subagents`, `tangle_run_status`,
   `tangle_execution_state`, `tangle_execution_details`, `tangle_execution_logs`,
   `tangle_execution_artifacts`).

3. Confirm the trigger-owned watcher is live with `list_subagents` before moving
   on.

```
[ ] GOAL + PLAN written to session memory
[ ] safety trigger created (target: subagent, template: safety-monitor, every 5 min)
[ ] trigger-owned safety-monitor watcher confirmed live (list_subagents)
--> only then spawn the designer
```

If you ever notice the monitor is missing, STOP and recreate it before
continuing. Never replace it with a manual `sleep -> read transcript` loop.

**Step 1 — Design.** Spawn `spawn_subagent template: designer`. It locates the
paper, decomposes it into a multi-step DAG, and produces a design image + design
doc + builder brief. It never builds or submits. Wait for its `DESIGN_READY`
reply (PDF status/path, design image path, design doc path, builder brief).

Before starting the builder, present the design image to the user under the
heading "For your information", showing it **both ways**:

- **Inline image** — `![Design](<design-image-path-or-url>)`.
- **Artifact link** — `[Design diagram](<design-image-path-or-url>)`.

Use the artifact's signed URL or local artifact path so both resolve.

**Step 2 — Build.** After `DESIGN_READY`, spawn `spawn_subagent template: builder`
with the builder brief as its task. The builder strictly implements the approved
DAG (lightweight Python components, separate component YAML/source per step,
explicit artifact wiring) and submits via the `tangle-deploy` CLI. Do NOT let it
collapse the DAG into one task — a monolithic task is incorrect even if it
validates/submits. It reports milestones with the markers `BUILDER_STARTED`,
`FILES_CREATED`, `CORRECTED_DAG_READY`, `VALIDATION_STATUS`, `PIPELINE_SUBMITTED`,
`SUBMISSION_FAILED`. Pass the current user's email so submits/annotations are
attributed correctly.

## Ongoing rules

1. **No manual polling.** Do NOT use a `sleep -> read room transcript` loop. Rely
   on subagent messages plus the safety trigger.
2. **Don't rush the builder.** Safety alerts are informational unless there is
   clear failure or sustained non-response.
3. **Surface artifacts.** Show any user-facing artifact as a clickable Markdown
   link or image, and pin important artifacts.
4. **Emit the progress chip.** The moment a real `ROOT_EXECUTION_ID` appears,
   emit one `tangent-ui:pipeline-progress` block per execution.
5. **One consolidated message per sync.** Keep the conversation clean: when
   several subagent reports (e.g. a builder milestone plus a safety tick about
   the same run) land together, fold them into a single human-facing message
   rather than posting each one. The progress chip is the live source of truth —
   do not echo its run state (task counts, statuses) in prose, and do not post a
   near-duplicate of your previous message.

## Retry posture (autonomous by default)

Run this flow **fully autonomously** — do not pause to ask the user for
permission to retry. Autonomous targeted retries are **enabled by default**: when
a run fails, apply narrow fixes and resubmit up to `N` times **without** asking,
as long as **all** of these hold:

- the DAG is unchanged,
- the fix is limited to the failed component,
- validation/hydration passes,
- compute scope/config is unchanged.

```yaml
autonomous_retry:
  enabled: true # default; no user confirmation needed
  max_retries: 2
  allowed_changes:
    - failed component source
    - regenerated component YAML
    - config typing/serialization fixes
  disallowed:
    - changing dataset scale
    - changing benchmark method
    - collapsing DAG
    - increasing compute
```

Only stop and surface to the user when human input is genuinely required: a fix
falls outside `allowed_changes`, the retry budget is exhausted, or the run
finally succeeds. Otherwise keep driving the flow yourself.

## On a safety-monitor alert

A terminal-status alert is **mandatory and non-negotiable**: the monitor MUST
fire the moment the tracked run flips to SUCCESS or FAIL, and you MUST act on it
immediately. The "Running — do not spam the user" guidance below never suppresses
a SUCCESS/FAIL transition alert.

- **Success (`PIPELINE_ENDED_SUCCESS`)** — automatically (do not wait for the
  user to ask) list artifacts for the final execution
  (`tangle_execution_artifacts`), fetch/pin them, and present each as a clickable
  link (and inline image for figures). At minimum surface: `metrics_csv`,
  `recall_qps_curve_png`, `recall_qps_curve_svg`, `summary_md` / `summary_html`,
  `repro_manifest`. If any expected artifact is missing, treat it as a failure and
  run the failure-triage subroutine — a successful run status does not prove every
  artifact was written.
- **Failure (`PIPELINE_ENDED_FAILURE`)** — run the failure-triage subroutine,
  then route a focused fix to the builder (or spawn `template: debugger`), keep
  the approved DAG intact, and submit a corrected retry only after
  validate/hydrate succeeds. If autonomous retry is enabled and the fix is in
  scope, apply it without waiting for per-fix approval.
- **Running** — do not spam the user; rely on the progress chip and terse monitor
  alerts only when useful.

## Failure-triage subroutine

When a run ends failed or with skipped tasks, run this before changing anything
(do it yourself or via `template: debugger`):

1. Get the root execution state — `tangle_execution_state(ROOT_EXECUTION_ID)`.
2. Identify the failed and skipped child tasks (`tangle_execution_details`).
3. Fetch the failed task's logs — `tangle_execution_logs(<failed_execution_id>)`.
4. Detect missing output artifacts — `tangle_execution_artifacts`.
5. Produce a structured triage report: failed task name, execution id, skipped
   task count, log excerpt (key error lines), likely root cause, exact files to
   change, and whether a retry is safe to do autonomously.

Record the triage outcome in session memory `CURRENT`, then route the focused fix.

## Known Tangle reproduction pitfalls

- Safety monitor must query **live execution state**, not transcript only.
- Numeric YAML config values may need quoting (Tangle expects some scalars as
  strings/argument objects), e.g. `root_task.arguments.nlist must be
string/argument object, got int`.
- Tangle output paths may be **extensionless**; writers must write exactly to the
  provided path. Matplotlib (and similar format-by-extension writers) require an
  explicit `format=` for extensionless output paths.
- Validate/hydrate success does **not** prove runtime artifact creation. Always
  smoke-test pure plotting/reporting components locally before submitting.
- If `prepare` fails, fix ingestion first — do not debug downstream tasks.

The builder enforces these pre-submit guardrails; see the builder brief
([`builder-brief-template.md`](.tangent/skills/reproduce-research/references/builder-brief-template.md))
and the `builder` agent template.

## Final reporting

When a real root execution id is available, emit exactly one progress widget per
execution:

````
```tangent-ui:pipeline-progress
{ "executionId": "<ROOT_EXECUTION_ID>" }
```
````

Use the real execution id; emit the block once per execution.
