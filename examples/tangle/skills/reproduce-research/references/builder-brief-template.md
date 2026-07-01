# Builder Implementation Brief

The Design subagent fills this in and hands it to the Builder subagent in (or
alongside) the `DESIGN_READY` reply. Keep it concise and unambiguous — the
builder implements exactly what is written here.

## Workspace

- **Path**: `tangent-work/<paper-slug>/`
- **Operate as**: the `builder` agent template (spawned via
  `spawn_subagent template: builder`).
- **CLI**: prefer `shadowenv exec -- tangle-deploy` when available. If `shadowenv`
  is not installed, report that and run `tangle-deploy` directly with the
  required env vars (`TANGLE_DEPLOY_SOURCE`, `TANGLE_AUTH`) set.
- **Source annotation** (set before any submit):
  ```bash
  export TANGLE_DEPLOY_SOURCE=$([ -n "$RIVER_SESSION_JWT" ] && echo "river-tangent" || echo "tangent")
  ```

## Tasks to build

Implement each as a separate lightweight Python component (separate YAML/source
per step preferred). Do NOT collapse into one task.

| #   | Task                      | Component | Inputs (wired from) | Outputs                                     |
| --- | ------------------------- | --------- | ------------------- | ------------------------------------------- |
| 1   | `prepare_dataset`         |           |                     | dataset dir, `dataset_manifest.json`        |
| 2   | `build_shared_artifacts`  |           |                     | shared artifact + manifest                  |
| 3   | `build_method_under_test` |           |                     | method artifact + manifest                  |
| 4   | `build_baseline`          |           |                     | baseline artifact + manifest                |
| 5   | `evaluate_sweep`          |           |                     | `eval_results.json`, per-item metrics       |
| 6   | `plot_results`            |           |                     | figure(s), `metrics.csv`                    |
| 7   | `write_report`            |           |                     | `summary.md`/`.html`, `repro_manifest.json` |

## Artifact wiring

```
dataset -> shared
dataset + shared -> method
dataset + shared -> baseline
dataset + shared + method + baseline -> evaluation
evaluation -> plots
manifests + metrics + plots -> report
```

## Config values

- **Method hyperparameters**:
- **Baseline hyperparameters**:
- **Sweep grid**:
- **Metrics + operating points**:
- **Seeds**:

## Reproducibility env

- **Threading** (set in components that time/compute): `OMP_NUM_THREADS=1`,
  `MKL_NUM_THREADS=1`, `OPENBLAS_NUM_THREADS=1`, `BLIS_NUM_THREADS=1`,
  `VECLIB_MAXIMUM_THREADS=1`, `NUMEXPR_NUM_THREADS=1`, and
  `faiss.omp_set_num_threads(1)` if using Faiss.
- **In-memory** eval; retain raw inputs for exact rerank / ground truth.
- **No batched timing** for throughput metrics.
- **Record**: library versions, CPU/thread settings, full config, seeds, caveats.

## Pre-submit checks (run before every submit)

Validation/hydration does not prove config types are right or that components
write their artifacts at runtime. Before submitting:

1. **Config arg-type lint** — root-task arg scalars Tangle expects as strings must
   be quoted in YAML; numeric-looking values serialized intentionally. Prevents
   422s like `root_task.arguments.nlist must be string/argument object, got int`.
2. **Exact artifact paths** — components write **exactly** to the provided
   (often extensionless) output path. Matplotlib/format-by-extension writers MUST
   pass explicit `format=`:
   ```python
   fig.savefig(output_png_path, format="png")
   fig.savefig(output_svg_path, format="svg")
   assert Path(output_png_path).exists()
   assert Path(output_svg_path).exists()
   ```
3. **Component smoke runs** — run pure-Python plotting/reporting stages locally
   against a tiny fixture using the exact extensionless output paths, and assert
   the files exist.

## Submission contract (reply markers, in order)

1. `BUILDER_STARTED` — workspace, files found/reused, immediate plan, intervention needed?
2. `FILES_CREATED` — component source paths, component YAML paths, pipeline path, config path, task list.
3. `CORRECTED_DAG_READY` — pipeline path, config path, exact tasks present, wiring summary, "not monolithic".
4. `VALIDATION_STATUS` — commands run, success/failure output, hydrated pipeline path; confirm pre-submit checks passed.
5. Submit with `--no-wait` only after validation success.
6. `PIPELINE_SUBMITTED` — pipeline path, config path, RUN_ID, ROOT_EXECUTION_ID, Tangle URL, source annotation.
7. `SUBMISSION_FAILED` (on failure) — exact command, exact error, files involved, next fix.
