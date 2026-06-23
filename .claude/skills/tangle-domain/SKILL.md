---
name: tangle-domain
description: Domain terminology and concepts for the Tangle platform. Use whenever discussing, naming, or working with pipelines, runs, components, tasks, inputs, outputs, executions, agent bundles, sessions, or any Tangle domain concepts.
---

# Tangle Domain Terminology

This is **shared platform vocabulary**, not a description of code in this repo.

**tangent-shell** (this repo) is the AI orchestration app. It drives agents and **produces
pipelines** that the rest of the platform consumes:

- **tangle**: the backend orchestration/runtime that executes pipelines.
- **tangle-ui**: the drag-and-drop frontend where pipelines are authored and runs are inspected.

Because tangent-shell sits upstream of those, the pipeline/component data structures below are
**defined and implemented in tangle / tangle-ui**, not here. Use these terms when naming things and
reasoning about what tangent-shell emits, but don't expect to find `ComponentSpec`, React Flow
canvas code, or a pipeline editor in this repo — if you need the implementation, it lives in the
sister repos. For the concepts this repo actually implements, see [Agent shell concepts](#agent-shell-concepts).

Never refer to the platform as "Pipeline Studio" — that is a legacy name.

## Pipeline data model (defined in tangle / tangle-ui)

### Pipeline

A **pipeline** is a directed acyclic graph (DAG) of components connected to produce a workflow.
Represented as a `ComponentSpec` with a `GraphImplementation`. A pipeline defines:

- **Inputs**: Data entry points (graph-level inputs)
- **Outputs**: Data exit points (graph-level outputs)
- **Tasks**: Configured component instances
- **Connections**: Edges linking outputs to inputs

### Component

A **component** is a reusable unit of computation defined by a `ComponentSpec`. Every component has:

- `name`, `description`
- `inputs`: Array of `InputSpec`
- `outputs`: Array of `OutputSpec`
- `implementation`: Either **container** (Docker) or **graph** (subgraph)
- `metadata`: Annotations, author, etc.

### Component Spec (ComponentSpec)

The canonical data structure that fully describes a component's interface, implementation, and
metadata. Compatible with Google Cloud Vertex AI Pipelines and Kubeflow v1 formats. Stored/shared as
YAML (`component.yaml`). The TypeScript type definitions live in **tangle-ui**. **Do not invent or
modify a ComponentSpec structure** in this repo — match what the sister repos define.

### Task

A **task** is a configured instance of a component within a pipeline. A `TaskSpec` includes:

- `componentRef`: Reference to the component definition
- `arguments`: Configured input values (literals, graph input references, upstream task output references, or secrets)
- `isEnabled`: Optional conditional execution predicate
- `executionOptions`: Retry and caching strategies
- `annotations`: Metadata

### Input vs Input Component

These are different things:

- **Input** (`InputSpec`): A parameter definition on a component — has name, type, description, default value, optional flag
- **Input Component**: A graph-level input that serves as a data source feeding into task inputs

### Output vs Output Component

Same distinction:

- **Output** (`OutputSpec`): A parameter definition on a component — has name, type, description
- **Output Component**: A graph-level output that collects data from upstream task outputs

### Subgraph

A task whose component has a `GraphImplementation` instead of a `ContainerImplementation`. This
enables nested pipelines.

### Run / Pipeline Run

A **run** is a submitted instance of a pipeline for execution. Each run has:

- `id`: Unique identifier
- `root_execution_id`: The root execution
- `pipeline_name`, `pipeline_digest`
- `status`, `statusCounts`
- `created_at`, `created_by`

### Execution

An **execution** is a lower-level entity — the execution of a single task within a run. Executions
form a tree:

- A run has one **root execution**
- The root execution branches into **child executions** for each task
- Subgraph tasks have their own child execution trees

**Run vs Execution**: A run is the top-level container users interact with. Executions are the
internal task-level tracking. Use `run_id` for run-level operations (listing, canceling, metadata)
and `execution_id` for task-level operations (details, artifacts, logs).

### Execution Status

`ContainerExecutionStatus`: PENDING, RUNNING, SUCCEEDED, FAILED, etc. Runs aggregate these via
`TaskStatusCounts`.

### Secrets

Sensitive values (API keys, credentials) stored securely in the backend and referenced by name in
task arguments via `SecretArgument`. Resolved at runtime — never embedded in pipeline definitions or
exports.

### Editor-only concepts (tangle-ui)

The visual editor in tangle-ui adds canvas concepts — **Task Node**, **Flex Node**, **Ghost Node**,
**Handle**, **Edge/Connection**, **Component Library**. These exist only in the editor and have no
representation in tangent-shell. Mentioned here only so the vocabulary is recognizable.

## Agent shell concepts

These are what tangent-shell actually implements (see `apps/web/src/features/*` and
`apps/server/src`):

- **Agent bundle**: A packaged agent (config + optional UI components) uploaded to the shell and run
  by the backend. Bundle metadata is described by `@tangent/shared/contracts`.
- **Session**: A live or historical conversation/run of an agent, surfaced in the chat UI.
- **Global memory**: Persisted cross-session memory the agent can read and write.
- **Trigger**: A scheduled or event-based rule that starts agent work.
- **Bundle UI**: A sandboxed runtime that renders a bundle's own UI components inside the shell.

When in doubt about whether a concept is "ours" or "theirs": data the shell stores and serves
(bundles, sessions, memory, triggers) is implemented here; the pipeline/run/component data model is
implemented in tangle / tangle-ui.
