// @ts-nocheck
/**
 * CSOM pipeline-editor tool extension, loaded into every session Pi process via
 * `--extension` (auto-discovered from this bundle's `tools/` dir).
 *
 * These tools let Prime build a Tangle pipeline *live* in the embedded editor.
 * Each tool is a thin client over the server's internal CSOM relay
 * (`POST /internal/csom/invoke`): the server forwards the call to the browser
 * tab hosting the Pipeline Editor (the session's connected remote environment),
 * which runs it against the editor and returns the result. The agent never
 * touches the editor directly.
 *
 * The editor tab must be open (Prime can surface the `pipeline-editor` UI
 * component to prompt the user). Until it is, calls return a "no editor
 * connected" message.
 *
 * Authored against Pi's extension runtime (it imports modules Pi resolves when
 * loading extensions, e.g. `typebox`), not this repo's `node_modules`. It is
 * excluded from type-check (`@ts-nocheck`) and never imported by the server.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const INTERNAL_URL = process.env.TANGENT_INTERNAL_URL ?? "";
const INTERNAL_TOKEN = process.env.TANGENT_INTERNAL_TOKEN ?? "";
const SESSION_ID = process.env.TANGENT_SESSION_ID ?? "";

interface CsomResponse {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Relays one CSOM method call to the session's editor and returns its result. */
async function invoke(method: string, args: unknown[]): Promise<CsomResponse> {
  const response = await fetch(`${INTERNAL_URL}/internal/csom/invoke`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${INTERNAL_TOKEN}`,
    },
    body: JSON.stringify({ sessionId: SESSION_ID, method, args }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`csom ${method} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<CsomResponse>;
}

function textResult(text: string) {
  return { content: [{ type: "text", text }], details: {} };
}

/** Runs a CSOM method and renders its outcome as readable text for the agent. */
async function run(method: string, args: unknown[]) {
  const res = await invoke(method, args);
  if (!res.ok) return textResult(res.error ?? `csom ${method} failed`);
  const value =
    res.value === undefined ? "ok" : JSON.stringify(res.value, null, 2);
  return textResult(value);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "csom_load_spec",
    label: "Pipeline: Load Spec",
    description:
      "Load a pipeline spec (YAML or JSON) into the editor in memory. Call this " +
      "first — mutating tools require a loaded pipeline. Pass an empty/minimal " +
      "spec to start a new pipeline from scratch.",
    promptSnippet: "Load a pipeline spec into the editor",
    parameters: Type.Object({
      spec: Type.String({ description: "Pipeline YAML or JSON to load." }),
      name: Type.Optional(Type.String({ description: "Optional name." })),
    }),
    execute: (_id, p) =>
      run("loadSpec", p.name === undefined ? [p.spec] : [p.spec, p.name]),
  });

  pi.registerTool({
    name: "csom_get_pipeline_state",
    label: "Pipeline: Get State",
    description:
      "Return the current pipeline graph (tasks, inputs, outputs, edges) with " +
      "their internal `$id`s. Use it to discover ids for mutating calls.",
    promptSnippet: "Read the current pipeline graph state",
    parameters: Type.Object({}),
    execute: () => run("getPipelineState", []),
  });

  pi.registerTool({
    name: "csom_get_spec_yaml",
    label: "Pipeline: Get YAML",
    description: "Serialize the current pipeline spec to YAML.",
    promptSnippet: "Get the current pipeline as YAML",
    parameters: Type.Object({}),
    execute: () => run("getSpecYaml", []),
  });

  pi.registerTool({
    name: "csom_set_pipeline_name",
    label: "Pipeline: Set Name",
    description: "Set the pipeline's display name.",
    promptSnippet: "Set the pipeline name",
    parameters: Type.Object({
      name: Type.String({ description: "New pipeline name." }),
    }),
    execute: (_id, p) => run("setPipelineName", [p.name]),
  });

  pi.registerTool({
    name: "csom_set_pipeline_description",
    label: "Pipeline: Set Description",
    description: "Set the pipeline's description.",
    promptSnippet: "Set the pipeline description",
    parameters: Type.Object({
      description: Type.String({ description: "New description." }),
    }),
    execute: (_id, p) => run("setPipelineDescription", [p.description]),
  });

  pi.registerTool({
    name: "csom_search_components",
    label: "Pipeline: Search Components",
    description:
      "Search the Tangle component library. Returns matches with the " +
      "`componentRef` you pass to `csom_add_task`.",
    promptSnippet: "Search Tangle components to add as tasks",
    parameters: Type.Object({
      query: Type.String({ description: "Search text." }),
      limit: Type.Optional(Type.Number({ description: "Max results." })),
    }),
    execute: (_id, p) =>
      run("searchComponents", [
        p.limit === undefined
          ? { query: p.query }
          : { query: p.query, limit: p.limit },
      ]),
  });

  pi.registerTool({
    name: "csom_add_task",
    label: "Pipeline: Add Task",
    description:
      "Add a task (a component instance) to the pipeline. `componentRef` comes " +
      "from `csom_search_components` (e.g. `{ url: 'https://.../train.yaml' }`). " +
      "Returns the new task's `taskId`.",
    promptSnippet: "Add a task to the pipeline",
    parameters: Type.Object({
      name: Type.String({ description: "Task name (unique in the pipeline)." }),
      componentRef: Type.Unknown({
        description: "ComponentReference for the task's component.",
      }),
    }),
    execute: (_id, p) =>
      run("addTask", [{ name: p.name, componentRef: p.componentRef }]),
  });

  pi.registerTool({
    name: "csom_delete_task",
    label: "Pipeline: Delete Task",
    description: "Delete a task by its entity `$id`.",
    promptSnippet: "Delete a task from the pipeline",
    parameters: Type.Object({
      entityId: Type.String({ description: "Task entity id." }),
    }),
    execute: (_id, p) => run("deleteTask", [p.entityId]),
  });

  pi.registerTool({
    name: "csom_rename_task",
    label: "Pipeline: Rename Task",
    description: "Rename a task by its entity `$id`.",
    promptSnippet: "Rename a task in the pipeline",
    parameters: Type.Object({
      entityId: Type.String({ description: "Task entity id." }),
      newName: Type.String({ description: "New task name." }),
    }),
    execute: (_id, p) => run("renameTask", [p.entityId, p.newName]),
  });

  pi.registerTool({
    name: "csom_add_input",
    label: "Pipeline: Add Input",
    description: "Add a pipeline-level input. Returns the new `inputId`.",
    promptSnippet: "Add a pipeline input",
    parameters: Type.Object({
      name: Type.String({ description: "Input name." }),
      type: Type.Optional(Type.String({ description: "Type annotation." })),
      description: Type.Optional(Type.String()),
      defaultValue: Type.Optional(Type.Unknown()),
      optional: Type.Optional(Type.Boolean()),
    }),
    execute: (_id, p) =>
      run("addInput", [
        {
          name: p.name,
          type: p.type,
          description: p.description,
          defaultValue: p.defaultValue,
          optional: p.optional,
        },
      ]),
  });

  pi.registerTool({
    name: "csom_add_output",
    label: "Pipeline: Add Output",
    description: "Add a pipeline-level output. Returns the new `outputId`.",
    promptSnippet: "Add a pipeline output",
    parameters: Type.Object({
      name: Type.String({ description: "Output name." }),
      type: Type.Optional(Type.String({ description: "Type annotation." })),
      description: Type.Optional(Type.String()),
    }),
    execute: (_id, p) =>
      run("addOutput", [
        { name: p.name, type: p.type, description: p.description },
      ]),
  });

  pi.registerTool({
    name: "csom_connect_nodes",
    label: "Pipeline: Connect Nodes",
    description:
      "Create an edge between two ports. Reference entities by their `$id` " +
      "(from `csom_get_pipeline_state` or a prior add call).",
    promptSnippet: "Connect two pipeline ports with an edge",
    parameters: Type.Object({
      sourceEntityId: Type.String(),
      sourcePortName: Type.String(),
      targetEntityId: Type.String(),
      targetPortName: Type.String(),
    }),
    execute: (_id, p) =>
      run("connectNodes", [
        {
          sourceEntityId: p.sourceEntityId,
          sourcePortName: p.sourcePortName,
          targetEntityId: p.targetEntityId,
          targetPortName: p.targetPortName,
        },
      ]),
  });

  pi.registerTool({
    name: "csom_delete_edge",
    label: "Pipeline: Delete Edge",
    description: "Delete an edge (binding) by its entity `$id`.",
    promptSnippet: "Delete an edge from the pipeline",
    parameters: Type.Object({
      entityId: Type.String({ description: "Edge/binding entity id." }),
    }),
    execute: (_id, p) => run("deleteEdge", [p.entityId]),
  });

  pi.registerTool({
    name: "csom_set_task_argument",
    label: "Pipeline: Set Task Argument",
    description:
      "Set a constant argument on a task's input. Reference the task by its " +
      "entity `$id`.",
    promptSnippet: "Set a task's input argument",
    parameters: Type.Object({
      taskEntityId: Type.String({ description: "Task entity id." }),
      inputName: Type.String({ description: "Input name on the task." }),
      value: Type.Unknown({ description: "Argument value." }),
    }),
    execute: (_id, p) =>
      run("setTaskArgument", [p.taskEntityId, p.inputName, p.value]),
  });

  pi.registerTool({
    name: "csom_validate_pipeline",
    label: "Pipeline: Validate",
    description:
      "Validate the current pipeline, returning any issues found (missing " +
      "connections, type mismatches, etc.).",
    promptSnippet: "Validate the current pipeline",
    parameters: Type.Object({}),
    execute: () => run("validatePipeline", []),
  });

  pi.registerTool({
    name: "csom_submit_run",
    label: "Pipeline: Submit Run",
    description:
      "Submit the current pipeline for a run. Returns the `runId` and root " +
      "execution id. Validate first.",
    promptSnippet: "Submit the current pipeline for a run",
    parameters: Type.Object({}),
    execute: () => run("submitPipelineRun", []),
  });
}
