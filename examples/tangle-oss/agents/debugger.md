---
name: debugger
description: Diagnose failed pipeline runs
tools: read, write, grep, bash
---

# Debugger Agent

Diagnose a failed pipeline run. Find the root cause, write a failure snapshot,
return a one-line diagnosis.

## Tools

Drive the open-source **Tangle CLI** via Bash (`uv run tangle ...`). See
[`.tangent/skills/tangle-cli/SKILL.md`](.tangent/skills/tangle-cli/SKILL.md) for
install, auth/env, and the full command reference. Run `uv run tangle quickstart`
to discover commands and `--help` on any command for details.

| What you need                                          | Command                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Execution tree & task states                           | `uv run tangle sdk pipeline-runs status RUN_ID`                              |
| Container logs (application stack traces, code errors) | `uv run tangle sdk pipeline-runs logs EXECUTION_ID`                          |
| List runs                                              | `uv run tangle api pipeline-runs list`                                       |
| Artifact URIs                                          | `uv run tangle sdk artifacts get --run-id RUN_ID --query '{"tasks": {...}}'` |
| Export pipeline spec                                   | `uv run tangle sdk pipeline-runs export RUN_ID --output output.yaml`         |

## Debugging Workflow

1. **Get failure details**: `uv run tangle sdk pipeline-runs status RUN_ID` —
   shows the execution tree with per-task status. Get execution IDs for failed
   tasks.
2. **Fetch container logs**: `uv run tangle sdk pipeline-runs logs EXECUTION_ID`
   for application logs (stack traces, code errors) from the failed task.
3. **Check upstream artifacts**: If logs mention missing data/inputs, check
   upstream task outputs — an upstream task may have produced empty or wrong
   output (`uv run tangle sdk artifacts get --run-id RUN_ID -q '{...}'`).
4. **Export the pipeline**: `uv run tangle sdk pipeline-runs export RUN_ID --output /tmp/pipeline.yaml`
   to get the exact pipeline spec used, along with its run arguments.
5. **Fix and re-run**: Modify the exported YAML, then:
   ```bash
   uv run tangle sdk pipelines validate /tmp/pipeline.yaml
   uv run tangle sdk pipeline-runs submit /tmp/pipeline.yaml \
     --config /tmp/pipeline.config.yaml --annotation tangent=true
   ```

## Inputs

- `run_id` — the failed run
- `failure_playbook` — scenario's failure playbook (YAML)
- `task_mapping` — task name → source file
- `snapshot_path` — where to write the snapshot

## Output

1. **Snapshot file** at `<snapshot_path>`:

```markdown
# Failure: <run_id>

- **Execution ID**: <exec_id>
- **Failed Task**: <task_name>
- **Failure Type**: <INFRA|CONFIG|TRAINING|EVAL|UNKNOWN>
- **Timestamp**: <iso8601>

## Error

<root cause>

## Container Logs (last 50 lines)

<logs>

## Resolution

- **Action**: <retry|record|fix|investigate>

## Lesson Learned

<one-line takeaway>
```

2. **Return message**: `<FAILURE_TYPE>: <description> → <action>`
