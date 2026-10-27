// @ts-nocheck
/**
 * Tangle API tool extension, loaded into every session Pi process via
 * `--extension` (auto-discovered from this bundle's `tools/` dir).
 *
 * Authored against Pi's extension runtime (it imports modules Pi resolves when
 * loading extensions, e.g. `typebox`), not this repo's `node_modules`. It is
 * excluded from type-check (`@ts-nocheck`) and never imported by the server —
 * only passed as a path to the Pi subprocess, which loads it with jiti.
 *
 * Every tool is a thin client over the server's internal egress proxy
 * (`POST /internal/egress`). The proxy validates the destination against the
 * allowlist and injects the Tangle credential server-side, so this agent never
 * holds the token. The logical `tangle` destination is resolved from the
 * server's deployment configuration; the bundle never chooses an API origin.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { savePipeline } from "../lib/savedPipeline.ts";

const INTERNAL_URL = process.env.TANGENT_INTERNAL_URL ?? "";
const INTERNAL_TOKEN = process.env.TANGENT_INTERNAL_TOKEN ?? "";
export interface EgressInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean>;
}

export interface EgressResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  json?: unknown;
  text?: string;
}

/** Calls the server-side egress proxy for one allowlisted Tangle request. */
async function egress(
  path: string,
  init: EgressInit = {},
): Promise<EgressResponse> {
  const input = { target: "tangle", path };
  const response = await fetch(`${INTERNAL_URL}/internal/egress`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${INTERNAL_TOKEN}`,
    },
    body: JSON.stringify({ input, init }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `tangle egress ${path} failed (${response.status}): ${text}`,
    );
  }
  return response.json() as Promise<EgressResponse>;
}

function textResult(text: string) {
  return { content: [{ type: "text", text }], details: {} };
}

/** Renders an egress response as readable text for the agent. */
function renderResult(res: EgressResponse) {
  const body =
    res.json !== undefined
      ? JSON.stringify(res.json, null, 2)
      : (res.text ?? "");
  const status = res.ok ? "" : ` (HTTP ${res.status})`;
  return textResult(
    `${status}${status ? "\n" : ""}${body || `HTTP ${res.status}`}`,
  );
}

const enc = encodeURIComponent;

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "tangle_pipeline_save",
    label: "Tangle: Save Pipeline",
    description:
      "Create or update a complete saved pipeline directly through the backend, without a browser editor. " +
      "Pass a full root_pipeline_task TaskSpec with componentRef.spec (including its name, tasks and wiring). " +
      "Backend TaskSpecs do not accept taskInfo; omit it from the root and nested tasks, including CLI-generated definitions. " +
      "Provide exactly one of file_path (create/upsert under the authenticated backend caller; use a unique path for a new pipeline) " +
      "or pipeline_id (replace an existing pipeline subject to backend permissions). " +
      "Updates replace the definition; include annotations you want to retain. Versioning follows the backend's existing policy. " +
      "Pass project_id from the session's project context to attach the saved pipeline through project resources. " +
      "Do not put project/run membership annotations in pipeline_run_annotations. " +
      "Returns saved identity, name, actual backend caller, version, and pipeline://remote/<id> target after persistence. " +
      "If project attachment fails, saved:true and project.attached:false describe partial success; do not create a duplicate. " +
      "Browser create_pipeline creates only an empty editor draft and returns a tab/environment. " +
      "Opening this saved target with open_workarea_target is optional after success.",
    promptSnippet:
      "Create or update a complete saved pipeline without an editor",
    parameters: Type.Object({
      file_path: Type.Optional(
        Type.String({
          minLength: 1,
          description:
            "Caller-owned storage path. Existing paths are overwritten by the backend upsert.",
        }),
      ),
      pipeline_id: Type.Optional(
        Type.String({
          minLength: 1,
          description:
            "Stable saved pipeline ID to update. Backend write permissions apply.",
        }),
      ),
      root_pipeline_task: Type.Record(
        Type.String(),
        Type.Unknown({
          description:
            "Complete authored TaskSpec, including its embedded componentRef.spec.",
        }),
      ),
      pipeline_run_annotations: Type.Optional(
        Type.Record(Type.String(), Type.String()),
      ),
      project_id: Type.Optional(
        Type.String({
          minLength: 1,
          description:
            "Project ID from session context; attaches the saved pipeline independently of the browser.",
        }),
      ),
    }),
    async execute(_id, params) {
      const saved = await savePipeline(egress, params);
      return {
        content: [{ type: "text", text: JSON.stringify(saved, null, 2) }],
        details: saved,
        ...(saved.project?.attached === false && { isError: true }),
      };
    },
  });

  pi.registerTool({
    name: "tangle_run_list",
    label: "Tangle: List Pipeline Runs",
    description:
      "List Tangle pipeline runs. Optional `filter` / `filter_query` narrow the " +
      "results; `page_token` pages through them. Returns the raw API JSON.",
    promptSnippet: "List Tangle pipeline runs",
    parameters: Type.Object({
      filter: Type.Optional(
        Type.String({ description: "Server-side filter expression." }),
      ),
      filter_query: Type.Optional(
        Type.String({ description: "Free-text filter query." }),
      ),
      page_token: Type.Optional(
        Type.String({ description: "Pagination token from a prior call." }),
      ),
      include_execution_stats: Type.Optional(
        Type.Boolean({ description: "Include per-run execution stats." }),
      ),
      include_pipeline_names: Type.Optional(
        Type.Boolean({ description: "Include pipeline names for each run." }),
      ),
    }),
    async execute(_id, params) {
      const query: Record<string, string | boolean> = {};
      if (params.filter) query.filter = params.filter;
      if (params.filter_query) query.filter_query = params.filter_query;
      if (params.page_token) query.page_token = params.page_token;
      if (params.include_execution_stats !== undefined) {
        query.include_execution_stats = params.include_execution_stats;
      }
      if (params.include_pipeline_names !== undefined) {
        query.include_pipeline_names = params.include_pipeline_names;
      }
      return renderResult(await egress("/api/pipeline_runs/", { query }));
    },
  });

  pi.registerTool({
    name: "tangle_run_status",
    label: "Tangle: Get Pipeline Run",
    description:
      "Get a single Tangle pipeline run by id, including its status. Set " +
      "`include_execution_stats` for per-task stats. Returns the raw API JSON.",
    promptSnippet: "Get a Tangle pipeline run's status by id",
    parameters: Type.Object({
      id: Type.String({ description: "Pipeline run id." }),
      include_execution_stats: Type.Optional(
        Type.Boolean({ description: "Include per-task execution stats." }),
      ),
    }),
    async execute(_id, params) {
      const query: Record<string, boolean> = {};
      if (params.include_execution_stats !== undefined) {
        query.include_execution_stats = params.include_execution_stats;
      }
      return renderResult(
        await egress(`/api/pipeline_runs/${enc(params.id)}`, { query }),
      );
    },
  });

  pi.registerTool({
    name: "tangle_run_submit",
    label: "Tangle: Submit Pipeline Run",
    description:
      "Create (submit) a Tangle pipeline run by POSTing a run body directly to " +
      "the API. The body must contain a `root_task` (a TaskSpec) and may include " +
      "`components` and `annotations`.\n\n" +
      "IMPORTANT: this is a thin pass-through. It does NOT perform the " +
      "hydrate step or the source/`tangent` annotation wiring that " +
      "`tangle sdk pipeline-runs submit` does client-side. Provide an " +
      "already-hydrated spec, or prefer the Tangle CLI (`uv run tangle ...`, " +
      "via bash) when you need that. Annotations can also be set after submit " +
      "with `tangle_run_annotation_set`.",
    promptSnippet: "Submit a Tangle pipeline run from a hydrated run body",
    parameters: Type.Object({
      root_task: Type.Unknown({
        description: "The root TaskSpec for the run.",
      }),
      components: Type.Optional(
        Type.Array(Type.Unknown(), {
          description: "Optional ComponentReference list.",
        }),
      ),
      annotations: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Optional run annotations (key/value).",
        }),
      ),
    }),
    async execute(_id, params) {
      const body: Record<string, unknown> = { root_task: params.root_task };
      if (params.components) body.components = params.components;
      if (params.annotations) body.annotations = params.annotations;
      return renderResult(
        await egress("/api/pipeline_runs/", { method: "POST", body }),
      );
    },
  });

  pi.registerTool({
    name: "tangle_run_cancel",
    label: "Tangle: Cancel Pipeline Run",
    description: "Cancel a running Tangle pipeline run by id.",
    promptSnippet: "Cancel a Tangle pipeline run by id",
    parameters: Type.Object({
      id: Type.String({ description: "Pipeline run id to cancel." }),
    }),
    async execute(_id, params) {
      return renderResult(
        await egress(`/api/pipeline_runs/${enc(params.id)}/cancel`, {
          method: "POST",
        }),
      );
    },
  });

  pi.registerTool({
    name: "tangle_run_annotation_set",
    label: "Tangle: Set Run Annotation",
    description:
      "Set (or update) a single annotation `key`=`value` on a Tangle pipeline " +
      "run. Useful for source/`tangent` attribution after a raw submit.",
    promptSnippet: "Set an annotation on a Tangle pipeline run",
    parameters: Type.Object({
      id: Type.String({ description: "Pipeline run id." }),
      key: Type.String({ description: "Annotation key." }),
      value: Type.Optional(Type.String({ description: "Annotation value." })),
    }),
    async execute(_id, params) {
      const query: Record<string, string> = {};
      if (params.value !== undefined) query.value = params.value;
      return renderResult(
        await egress(
          `/api/pipeline_runs/${enc(params.id)}/annotations/${enc(params.key)}`,
          { method: "PUT", query },
        ),
      );
    },
  });

  pi.registerTool({
    name: "tangle_execution_state",
    label: "Tangle: Execution State",
    description:
      "Get the graph execution state for a Tangle execution id (status totals, " +
      "child execution summary). Use this for lightweight run-progress polling.",
    promptSnippet: "Get a Tangle execution's state by id",
    parameters: Type.Object({
      id: Type.String({ description: "Execution id (root or child)." }),
    }),
    async execute(_id, params) {
      return renderResult(
        await egress(`/api/executions/${enc(params.id)}/state`),
      );
    },
  });

  pi.registerTool({
    name: "tangle_execution_details",
    label: "Tangle: Execution Details",
    description:
      "Get full details for a Tangle execution id. Heavier than " +
      "`tangle_execution_state`; use after completion or for debugging.",
    promptSnippet: "Get a Tangle execution's full details by id",
    parameters: Type.Object({
      id: Type.String({ description: "Execution id." }),
    }),
    async execute(_id, params) {
      return renderResult(
        await egress(`/api/executions/${enc(params.id)}/details`),
      );
    },
  });

  pi.registerTool({
    name: "tangle_execution_logs",
    label: "Tangle: Execution Container Log",
    description:
      "Fetch the container (pod stdout/stderr) log for a Tangle execution id. " +
      "Use for stack traces and application errors from a failed task.",
    promptSnippet: "Fetch a Tangle execution's container log by id",
    parameters: Type.Object({
      id: Type.String({ description: "Execution id." }),
    }),
    async execute(_id, params) {
      return renderResult(
        await egress(`/api/executions/${enc(params.id)}/container_log`),
      );
    },
  });

  pi.registerTool({
    name: "tangle_execution_artifacts",
    label: "Tangle: Execution Artifacts",
    description: "List the output artifacts produced by a Tangle execution id.",
    promptSnippet: "List a Tangle execution's artifacts by id",
    parameters: Type.Object({
      id: Type.String({ description: "Execution id." }),
    }),
    async execute(_id, params) {
      return renderResult(
        await egress(`/api/executions/${enc(params.id)}/artifacts`),
      );
    },
  });

  pi.registerTool({
    name: "tangle_artifact_signed_url",
    label: "Tangle: Artifact Signed URL",
    description:
      "Get a signed download URL for a Tangle artifact by id, so its contents " +
      "can be fetched directly.",
    promptSnippet: "Get a signed download URL for a Tangle artifact",
    parameters: Type.Object({
      id: Type.String({ description: "Artifact id." }),
    }),
    async execute(_id, params) {
      return renderResult(
        await egress(`/api/artifacts/${enc(params.id)}/signed_artifact_url`),
      );
    },
  });
}
