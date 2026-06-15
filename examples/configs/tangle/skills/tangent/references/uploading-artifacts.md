# Ingesting uploaded artifacts into Tangle pipelines

The canonical way to bring a locally-staged artifact (data file, model checkpoint,
config bundle, reference dataset, …) into a Tangle pipeline is:

1. **Upload** the artifact to GCS (see `agents/uploader.md`).
2. **Add or update** a task in the pipeline that uses the **"Download from GCS"**
   component to pull the artifact at run time and emit it as a `Data` output.
3. **Wire** the `Data` output into the downstream task that needs the artifact.

This component is the audited, transparent ingest path. Do not write a custom
shell-out component or bake the artifact into a Docker image just to get it
into a pipeline.

## The "Download from GCS" component

| Field  | Value                                                                       |
| ------ | --------------------------------------------------------------------------- |
| Name   | `Download from GCS`                                                         |
| Digest | `30c424ac6156c478aa0c3027b470baf9cb7dbbf90aebcabde7469bfbd02a512e`          |
| Image  | `google/cloud-sdk`                                                          |
| Input  | `GCS path` (URI — single blob or directory; trailing slash means directory) |
| Output | `Data` (file path or directory path the next task can consume)              |

It runs `gsutil cp` for single blobs and `gsutil rsync -r` for directories.
Inspect it any time with:

```bash
shadowenv exec -- tangle-deploy component inspect \
  --digest 30c424ac6156c478aa0c3027b470baf9cb7dbbf90aebcabde7469bfbd02a512e \
  --full-spec
```

## Recipe A — Add a new ingest task to an existing pipeline

When the pipeline does not already have a "Download from GCS" task and you
need to introduce one — e.g., a new feature dataset, a model checkpoint to
fine-tune from, an external evaluation set.

1. **Export and dehydrate** the pipeline (see `iterating-on-runs.md`):

   ```bash
   shadowenv exec -- tangle-deploy pipeline-run export <RUN_ID> \
     /tmp/pipeline.yaml --dehydrate
   ```

2. **Add the ingest task** to the top-level graph or the appropriate subgraph:

   ```yaml
   tasks:
     downloadInputData:
       componentRef:
         digest: 30c424ac6156c478aa0c3027b470baf9cb7dbbf90aebcabde7469bfbd02a512e
       arguments:
         GCS path:
           # Hard-code for a one-shot run:
           constant: "gs://my-bucket/path/to/artifact/"
           # Or, to make the path a run-time parameter:
           # graphInput: {inputName: input_artifact_uri}
   ```

3. **Wire the `Data` output** into the consumer task by replacing whatever
   argument used to supply the artifact:

   ```yaml
   tasks:
     myTrainer:
       arguments:
         training_data:
           taskOutput:
             taskId: downloadInputData
             outputName: Data
   ```

4. **Validate, then submit**:

   ```bash
   shadowenv exec -- tangle-deploy pipeline-run validate /tmp/pipeline.yaml
   if grep -q '  spec:' /tmp/pipeline.yaml; then
     echo "ERROR: dehydrate first"; exit 1
   fi
   shadowenv exec -- tangle-deploy pipeline-run submit /tmp/pipeline.yaml \
     -f /tmp/pipeline.config.yaml --hydrate --no-wait
   ```

   The config file must include `annotations: {tangent: "true"}` per
   `references/tangle-tools.md` Submission Rules.

## Recipe B — Swap an existing GCS path

When the pipeline already has a "Download from GCS" task and you only need
to point it at a new artifact.

1. Find the task in the dehydrated YAML — search for the component digest
   `30c424ac6156c478aa0c3027b470baf9cb7dbbf90aebcabde7469bfbd02a512e` or for
   `arguments.GCS path:`.
2. Replace the value:
   ```yaml
   # Before
   arguments:
     GCS path:
       constant: "gs://old-bucket/old/path/"
   # After
   arguments:
     GCS path:
       constant: "gs://new-bucket/new/path/"
   ```
3. Validate + submit as in Recipe A.

## Recipe C — Pass the URI through the run config

When you want to keep the pipeline YAML stable across runs and only change
the artifact URI per submission — useful for Tangent auto-loop iterations
that rotate through uploaded variants.

1. In the pipeline YAML, declare an input on the top-level graph:
   ```yaml
   inputs:
     - name: input_artifact_uri
       type: URI
   ```
2. Wire it through to the "Download from GCS" task:
   ```yaml
   tasks:
     downloadInputData:
       componentRef:
         digest: 30c424ac6156c478aa0c3027b470baf9cb7dbbf90aebcabde7469bfbd02a512e
       arguments:
         GCS path:
           graphInput: { inputName: input_artifact_uri }
   ```
3. Supply the URI per run via the config file passed with `-f`. **The
   run-config schema uses top-level `args:`** (not `arguments:` — that
   key is reserved for _task-level_ argument wiring inside the pipeline
   YAML, as shown in step 2 above). See
   `tangle-deploy pipeline-run submit --help-full` for the full schema.
   ```yaml
   # pipeline.config.yaml
   args:
     input_artifact_uri: "gs://my-bucket/path/to/artifact/"
   annotations:
     tangent: "true"
   ```

## Why `arguments:` vs. `args:`

Two different keys, two different files:

| Key          | Where it lives                                           | What it does                                                         |
| ------------ | -------------------------------------------------------- | -------------------------------------------------------------------- |
| `arguments:` | Pipeline YAML, under each `tasks.<TaskName>:`            | Wires a task input to a `constant`, `graphInput`, or `taskOutput`.   |
| `args:`      | Run-config YAML passed via `-f` to `pipeline-run submit` | Binds values to the pipeline's top-level `inputs:` for a single run. |

If you mix them up, the submit may succeed with an unset/default input,
leaving the pipeline pointed at a stale or unrelated artifact. Verify before
submit by `grep -E '^(args|arguments):' pipeline.config.yaml` — the
run-config file should match only `args:` at the top level.

## Gotchas

- **Trailing slash matters.** `gs://b/p/file` is treated as a single blob;
  `gs://b/p/dir/` is treated as a directory prefix and copied with
  `gsutil rsync -r`. The component's `Data` output is shaped accordingly —
  downstream tasks must read it as a file vs. a directory.
- **Bucket auth.** The component runs `gcloud auth activate-service-account`
  with `GOOGLE_APPLICATION_CREDENTIALS` when set; otherwise it relies on the
  pod's default credentials. Make sure the task's service account has
  `storage.objects.get` on the bucket. If a run fails with a 403 on this
  task, this is almost always the cause — fix it with the `tangent auth`
  agent (Mode 1 or Mode 3).
- **Use the digest, not just the name.** Pinning to the digest above keeps
  the pipeline reproducible. `name: "Download from GCS"` works too and will
  resolve to the latest published version at hydrate time.
- **Don't hand-roll an ingest component.** If you find yourself writing
  `gsutil cp` in a custom container, stop — that's what this component
  exists for.
- **Privacy.** Be deliberate about the bucket. `gs://shopify-discovery-relevance`
  is broadly readable inside Shopify-discovery. PII, customer data, or
  embargoed models belong in a project-scoped bucket.
