Use `tangent builder` to reproduce RaBitQ (Gao & Long, SIGMOD 2024) on SIFT1M vs a PQ baseline. The deliverable is a Tangle pipeline that emits Recall@k vs QPS curves, single-threaded CPU, in-memory.

You MUST delegate implementation to a subagent. Do not build directly in Prime unless recovering from a failed/non-responsive subagent.

If Tangle terminology is unclear, automatically use the `tangle-help` skill to clarify before proceeding.

Prime orchestration requirements:

1. First create a safety trigger that fires every 1 minute. It must use a dedicated safety-monitor subagent, not Prime, and must:
   - read recent room transcript
   - list subagent statuses
   - check whether the plan is on track
   - alert Prime only if a subagent is non-responsive, reports failure, submits a run, or misses required fields
2. Do NOT use a manual `sleep -> read room transcript` polling loop. Rely on subagent messages and the safety trigger.
3. Do not rush the builder. Safety alerts are informational unless there is clear failure or sustained non-response.
4. Show any user-facing artifact as a clickable Markdown link or image and pin important artifacts.

Required workflow:

PHASE 1 — Design subagent
Delegate to one subagent first. It must NOT build or submit anything.

Design subagent tasks:

1. Understand the assignment and split it into concrete steps.
2. Find/download the RaBitQ arXiv PDF if available. Copy it to `artifacts/`, pin it, and notify Prime with the artifact path.
3. Build a design for a multi-step Tangle pipeline using lightweight Python components.
4. Convert the design to an image artifact under `artifacts/` and pin it.
5. Write a design doc under `artifacts/` and pin it.
6. Final design reply MUST include:
   - `DESIGN_READY`
   - PDF status/path
   - design image path
   - design doc path
   - concise implementation brief for builder

The design MUST specify a visible multi-step DAG, not a monolithic task. The required DAG is:

1. `prepare_sift1m_dataset`
   - Inputs: dataset URI/source, download flag, expected files/checksums
   - Outputs: `sift_dir`, `dataset_manifest.json`

2. `build_shared_ivf`
   - Inputs: `sift_dir`, `nlist`, seed, train size, train iterations
   - Outputs: `ivf_index` directory or artifact, `ivf_manifest.json`
   - Purpose: train one shared IVF quantizer and assignments reused by both methods

3. `build_rabitq_index`
   - Inputs: `sift_dir`, `ivf_index`, `Bq`, `epsilon0`, seed
   - Outputs: `rabitq_index` directory, `rabitq_index_manifest.json`

4. `build_pq_index`
   - Inputs: `sift_dir`, `ivf_index`, `pq_M`, `pq_nbits`, seed, rerank grid
   - Outputs: `pq_index` directory, `pq_index_manifest.json`

5. `evaluate_ann_sweep`
   - Inputs: `sift_dir`, `ivf_index`, `rabitq_index`, `pq_index`, `nprobe_grid`, `pq_rerank_grid`, `k_values`
   - Outputs: `eval_results.json`, `per_query_metrics.csv/parquet`, metrics summary
   - Must process queries one at a time for QPS timing; no batched timing

6. `plot_recall_qps`
   - Inputs: `eval_results.json`
   - Outputs: `recall_qps_curve.png`, `recall_qps_curve.svg`, `metrics.csv`

7. `write_experiment_report`
   - Inputs: dataset/IVF/RaBitQ/PQ manifests, eval results, plot artifacts
   - Outputs: `summary.md` or `summary.html`, `repro_manifest.json`

Prime must present the design image to the user with the heading/text “For your information” before starting the builder phase.

PHASE 2 — Builder subagent
After `DESIGN_READY`, delegate to a separate subagent explicitly instructed to operate as `tangent builder`.

Builder requirements:

1. Read and follow `main/agents/builder.md` and required references, especially canonical/from-scratch experiment pipeline and Tangle CLI submission rules.
2. Use `shadowenv exec -- tangle-deploy`; do NOT use API/MCP submit tools.
3. Set:
   `TANGLE_DEPLOY_SOURCE=$([ -n "$RIVER_SESSION_JWT" ] && echo "river-tangent" || echo "tangent")`
   before any submit.
4. Build under an inferred workspace, likely:
   `tangent-work/rabitq-sift1m/`
5. Strictly implement the approved seven-task DAG. Do NOT collapse into one “benchmark” task. A monolithic task is considered incorrect even if it validates/submits.
6. Use lightweight Python components. Separate component YAML/source per step is preferred. At minimum, the Tangle UI DAG must visibly show the seven required tasks and artifact wiring.
7. Wire outputs between tasks:
   - dataset → IVF
   - dataset + IVF → RaBitQ
   - dataset + IVF → PQ
   - dataset + IVF + RaBitQ + PQ → evaluation
   - evaluation → plotting
   - manifests + metrics + plots → report
8. Reuse code only if split across correct task boundaries.

Experiment requirements:

- Dataset: SIFT1M, preferably standard public ANN-Benchmarks/TexMex source
- Compare IVF+RaBitQ vs IVF+PQ
- Shared IVF: `nlist=4096`
- RaBitQ: `Bq=4`, `epsilon0=1.9`, bound-driven exact rerank approximation if exact author implementation is not available
- PQ baseline: `M=64`, `nbits=4`, rerank budgets `[500,1000,2500]`
- Sweep `nprobe=[1,2,4,8,16,32,64,128]`
- Emit Recall@1, Recall@10, Recall@100 vs QPS
- Single-threaded CPU only:
  - `OMP_NUM_THREADS=1`
  - `MKL_NUM_THREADS=1`
  - `OPENBLAS_NUM_THREADS=1`
  - `BLIS_NUM_THREADS=1`
  - `VECLIB_MAXIMUM_THREADS=1`
  - `NUMEXPR_NUM_THREADS=1`
  - call `faiss.omp_set_num_threads(1)` if using Faiss
- In-memory search/evaluation
- Keep raw base vectors available for exact reranking
- Do not batch queries during QPS timing
- Record reproducibility metadata, library versions, CPU/thread settings, config, seeds, and caveats

Builder critical communication rules:

1. Do not go silent. Long-running work is fine, but report milestone progress.
2. First reply immediately with:
   `BUILDER_STARTED`
   - workspace
   - files found/reused
   - immediate plan
   - whether Prime intervention is needed
3. After creating files, reply:
   `FILES_CREATED`
   - list all component source paths
   - list all component YAML paths
   - pipeline path
   - config path
   - task list
4. Before any submission, reply:
   `CORRECTED_DAG_READY`
   - pipeline path
   - config path
   - exact seven tasks present
   - artifact wiring summary
   - confirmation: “not monolithic”
5. Then validate/hydrate/auto-layout and reply:
   `VALIDATION_STATUS`
   - commands run
   - success/failure output
   - hydrated pipeline path
6. Only after `CORRECTED_DAG_READY` and validation success, submit with `--no-wait`.
7. Final success reply MUST include:
   `PIPELINE_SUBMITTED`
   - pipeline path
   - config path
   - RUN_ID
   - ROOT_EXECUTION_ID if available
   - production Oasis URL
   - source annotation
8. Final failure reply MUST include:
   `SUBMISSION_FAILED`
   - exact command
   - exact error
   - files involved
   - next fix

Prime final reporting:

- When a real root execution id is available, emit exactly one progress widget:

```tangent-ui:pipeline-progress
{ "executionId": "<ROOT_EXECUTION_ID>" }
```
