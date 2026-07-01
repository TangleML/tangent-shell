# Iterating on pipelines from existing runs

When modifying and re-running an existing pipeline (e.g. change params for failed tasks):

1. **Export the run (dehydrated)**:

   ```bash
   tangle-deploy pipeline-run export <run_id> /tmp/pipeline.yaml --dehydrate
   ```

   This produces the pipeline YAML and a `.config.yaml` with the run arguments.
   `--dehydrate` replaces inline component specs with compact references (`digest:` for
   published components, `url: file://` for local ones), making the YAML smaller and
   easier to edit.

2. **Inspect execution statuses**: `tangle-deploy pipeline-run details RUN_ID --state`
   to identify failed/cancelled/skipped executions.

3. **Understand the YAML structure**: Tangle pipelines are nested subgraphs. Inputs flow
   through the hierarchy via `graphInput` wiring: top-level task output → subgraph input →
   nested subgraph input → leaf task argument. Trace the wiring at each level before
   modifying. Run `tangle-deploy docs pipeline` for pipeline schema details and
   `tangle-deploy docs component` for component schema details.

4. **Modify the pipeline**: Edit the dehydrated YAML directly. To replace a component,
   swap its `digest:` or `url: file://` reference with a new `url: file://` reference
   pointing to the replacement component file.

5. **Preview**: `tangle-deploy pipeline view /tmp/pipeline.yaml --hydrate` to visually
   verify in the Tangle UI.

6. **Submit** (see Submission Rules in `references/tangle-tools.md`):
   ```bash
   if grep -q '  spec:' /tmp/pipeline.yaml; then echo "ERROR: dehydrate first"; exit 1; fi
   tangle-deploy pipeline-run submit /tmp/pipeline.yaml \
     -f /tmp/pipeline.config.yaml --hydrate --no-wait
   ```
   Ensure the config file includes `annotations: {tangent: "true"}`.
   Or annotate after: `tangle-deploy pipeline-run annotations set <RUN_ID> tangent true`
