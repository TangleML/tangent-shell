import type { EgressInit, EgressResponse } from "../tools/tangle-api.ts";

/** The same trusted egress transport used by the bundle's run tools. */
export type TangleEgress = (
  path: string,
  init?: EgressInit,
) => Promise<EgressResponse>;

export interface SavePipelineInput {
  file_path?: string;
  pipeline_id?: string;
  root_pipeline_task: Record<string, unknown>;
  pipeline_run_annotations?: Record<string, string>;
  project_id?: string;
}

export interface SavedPipelineResult {
  saved: true;
  id: string;
  name: string;
  user_id: string;
  authenticated_user_id: string;
  file_path: string;
  version: string;
  current_version: string;
  versioning_mode: string;
  target: string;
  project?: { id: string; attached: boolean; error?: string };
}

class PipelineApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireEmbeddedSpec(task: Record<string, unknown>): void {
  const ref = task.componentRef;
  const spec = isRecord(ref) ? ref.spec : undefined;
  if (!isRecord(spec) || typeof spec.name !== "string" || !spec.name.trim()) {
    throw new Error(
      "Provide a complete pipeline with a named embedded componentRef.spec; a reference-only task cannot be opened in the pipeline editor.",
    );
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `The backend returned no ${field}. Persistence is unconfirmed; check the saved path before retrying.`,
    );
  }
  return value;
}

async function requestJson(
  egress: TangleEgress,
  path: string,
  action: string,
  init?: EgressInit,
): Promise<Record<string, unknown>> {
  const response = await egress(path, init).catch((error: unknown) => {
    throw new Error(
      `${action}: ${String(error)}. If a write was sent, check its path/id before retrying; persistence is unconfirmed.`,
    );
  });
  if (!response.ok) {
    const detail =
      response.json === undefined
        ? response.text
        : JSON.stringify(response.json);
    throw new PipelineApiError(
      response.status,
      `${action} failed (HTTP ${response.status}): ${detail || "no error detail"}`,
    );
  }
  if (!isRecord(response.json)) {
    throw new Error(
      `${action} returned no JSON document. Check the saved path before retrying a write.`,
    );
  }
  return response.json;
}

function saveLocation(input: SavePipelineInput): {
  path: string;
  query?: Record<string, string>;
} {
  if (Boolean(input.file_path?.trim()) === Boolean(input.pipeline_id?.trim())) {
    throw new Error(
      "Provide exactly one of file_path (create/upsert) or pipeline_id (update).",
    );
  }
  if (input.pipeline_id?.trim()) {
    return {
      path: `/api/pipelines/${encodeURIComponent(input.pipeline_id.trim())}`,
    };
  }
  return {
    path: "/api/users/me/pipelines",
    query: { file_path: input.file_path!.trim() },
  };
}

async function backendWriter(egress: TangleEgress): Promise<string> {
  const caller = await requestJson(
    egress,
    "/api/users/me",
    "Verify backend editing identity",
  );
  const id = requireString(caller.id, "authenticated user id");
  if (
    !Array.isArray(caller.permissions) ||
    !caller.permissions.includes("write")
  ) {
    throw new Error(
      `Backend caller ${id} does not have write permission. Authenticate with a pipeline writer's credential.`,
    );
  }
  return id;
}

function savedResult(
  document: Record<string, unknown>,
  input: SavePipelineInput,
  caller: string,
): SavedPipelineResult {
  const id = requireString(document.id, "pipeline id");
  const owner = requireString(document.user_id, "pipeline owner");
  const filePath = requireString(document.file_path, "pipeline file path");
  if (
    input.pipeline_id &&
    id.toLowerCase() !== input.pipeline_id.trim().toLowerCase()
  ) {
    throw new Error(
      "The backend returned a different pipeline id. Check persistence before retrying.",
    );
  }
  if (input.file_path && filePath !== input.file_path.trim()) {
    throw new Error(
      "The backend returned a different pipeline file path. Check persistence before retrying.",
    );
  }
  if (!isRecord(document.root_pipeline_task)) {
    throw new Error(
      "The backend returned no saved pipeline definition. Check persistence before retrying.",
    );
  }
  requireEmbeddedSpec(document.root_pipeline_task);
  return {
    saved: true,
    id,
    name:
      typeof document.pipeline_name === "string" && document.pipeline_name
        ? document.pipeline_name
        : filePath,
    user_id: owner,
    authenticated_user_id: caller,
    file_path: filePath,
    version: requireString(document.version, "pipeline version"),
    current_version: requireString(
      document.current_version,
      "current pipeline version",
    ),
    versioning_mode: requireString(
      document.versioning_mode,
      "versioning policy",
    ),
    target: `pipeline://remote/${id}`,
  };
}

async function projectContainsPipeline(
  egress: TangleEgress,
  path: string,
  pipelineId: string,
): Promise<boolean> {
  let pageToken: string | undefined;
  do {
    const page = await requestJson(
      egress,
      path,
      "Check project pipeline attachment",
      {
        query: {
          entity: "pipeline",
          page_size: 100,
          ...(pageToken && { page_token: pageToken }),
        },
      },
    );
    if (!Array.isArray(page.resources)) {
      throw new Error(
        "The backend returned no project resource list; attachment is unconfirmed.",
      );
    }
    if (
      page.resources.some(
        (resource) =>
          isRecord(resource) &&
          resource.entity === "pipeline" &&
          resource.entity_id === pipelineId,
      )
    )
      return true;
    pageToken =
      typeof page.next_page_token === "string"
        ? page.next_page_token
        : undefined;
  } while (pageToken);
  return false;
}

async function attachPipeline(
  egress: TangleEgress,
  projectId: string,
  saved: SavedPipelineResult,
): Promise<void> {
  const path = `/api/projects/${encodeURIComponent(projectId)}/resources/`;
  try {
    await requestJson(egress, path, "Attach saved pipeline to project", {
      method: "POST",
      body: { entity: "pipeline", entity_id: saved.id, name: saved.name },
    });
  } catch (error) {
    // The backend rejects duplicate references. Verify the existing association on retry.
    if (
      error instanceof PipelineApiError &&
      error.status === 409 &&
      (await projectContainsPipeline(egress, path, saved.id))
    )
      return;
    throw error;
  }
}

/** Saves a full definition first; project attachment is a separate, honest outcome. */
export async function savePipeline(
  egress: TangleEgress,
  input: SavePipelineInput,
): Promise<SavedPipelineResult> {
  const { path, query } = saveLocation(input);
  requireEmbeddedSpec(input.root_pipeline_task);
  const caller = await backendWriter(egress);
  const body = {
    root_pipeline_task: input.root_pipeline_task,
    ...(input.pipeline_run_annotations !== undefined && {
      pipeline_run_annotations: input.pipeline_run_annotations,
    }),
  };
  // The backend owns validation, ACLs and versioning. An omitted mode preserves its policy.
  const document = await requestJson(egress, path, "Save pipeline", {
    method: "PUT",
    query,
    body,
  });
  const saved = savedResult(document, input, caller);
  if (!input.project_id) return saved;
  try {
    await attachPipeline(egress, input.project_id, saved);
    saved.project = { id: input.project_id, attached: true };
  } catch (error) {
    saved.project = {
      id: input.project_id,
      attached: false,
      error: String(error),
    };
  }
  return saved;
}
