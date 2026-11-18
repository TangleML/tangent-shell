import { normalizeShellUrl } from "@tangent/local-agent-host/shellUrl.ts";
import type {
  CreateSessionRequest,
  ListAgentBundlesResponse,
  Session,
} from "@tangent/shared/contracts.ts";

import type { ProjectTarget } from "./config.ts";
import { type FetchFor, requestJson } from "./http.ts";

interface Workspace {
  id: string;
  name: string;
  is_active?: boolean;
  data?: { tangentBaseUrl?: unknown } | null;
}

interface Project {
  id: string;
  name: string;
  workspace_id: string;
  data?: { tangentSharedFolderId?: unknown } | null;
}

export interface OpenedSession {
  session: Session;
  shellUrl: string;
  /** Set when the session was started in a Tangle project. */
  projectUrl?: string;
  /** Something that went wrong after the session was created. */
  warning?: string;
}

// Tangle reads a run's project from this annotation; the id is in the key.
const RUN_ANNOTATION_PREFIX = "tangleml.com/project/id/";
const ROOT_CONFIG_FILE = "tangle-deploy-root-config.yaml";
// Where the Tangle UI mounts a project's shared folder, and its memory roots.
const PROJECT_MOUNT = "project";

const segment = encodeURIComponent;

async function findWorkspace(
  api: string,
  ref: string,
  tangle: typeof fetch,
): Promise<Workspace> {
  const { workspaces } = await requestJson<{ workspaces: Workspace[] }>(
    tangle,
    `${api}/workspaces/`,
  );
  // Retired workspaces are still listed but refuse new projects.
  const active = workspaces.filter(
    (workspace) => workspace.is_active !== false,
  );
  const wanted = ref.toLowerCase();
  const match = active.find(
    (workspace) =>
      workspace.id === ref || workspace.name.toLowerCase() === wanted,
  );
  if (!match) {
    const names = active.map((workspace) => workspace.name).join(", ");
    throw new Error(`No workspace "${ref}". Available: ${names}`);
  }
  return match;
}

/**
 * A workspace names its Tangent Shell in its metadata, as the Tangle UI reads
 * it; a path is relative to Tangle, as it is in the browser.
 */
function shellUrlOf(workspace: Workspace, tangleUrl: string): string {
  const url = workspace.data?.tangentBaseUrl;
  if (typeof url !== "string" || !url.trim()) {
    throw new Error(`Workspace "${workspace.name}" has no Tangent Shell.`);
  }
  return normalizeShellUrl(new URL(url.trim(), tangleUrl).href);
}

/**
 * Reaches the Shell before anything is created, so a failed sign-in or a
 * missing bundle does not leave an empty project behind.
 */
async function checkShell(
  shellUrl: string,
  bundleId: string,
  shell: typeof fetch,
): Promise<void> {
  const { bundles } = await requestJson<ListAgentBundlesResponse>(
    shell,
    `${shellUrl}/api/agent-bundles`,
  );
  if (!bundles.some((bundle) => bundle.id === bundleId)) {
    const ids = bundles.map((bundle) => bundle.id).join(", ");
    throw new Error(`No bundle "${bundleId}" on the Shell. Available: ${ids}`);
  }
}

function sharedFolderOf(project: Project): string | undefined {
  const id = project.data?.tangentSharedFolderId;
  return typeof id === "string" && id.trim() ? id : undefined;
}

function projectNote(project: Project, annotation: string, shared: boolean) {
  const lines = [
    `This session belongs to the Tangle project "${project.name}" (id ${project.id}).`,
    "Runs submitted with `tangle-deploy pipeline-run submit` or `submit-from-python`",
    "are attributed to it through TANGLE_ROOT_CONFIG. Do not pass -a/--annotations",
    "to those, because it drops the project key; add annotations with --config.",
    "A run submitted any other way must carry the annotation",
    `\`${annotation}: "true"\` when it is created. Never put that key on a saved`,
    "pipeline; the pipeline write path rejects it.",
  ];
  if (shared) {
    lines.push(
      `\`${PROJECT_MOUNT}/\` is the project's shared folder, mounted in every session of`,
      "this project, and your memory_* tools write there. Put work other sessions",
      "should build on there, never secrets.",
    );
  }
  return lines.join("\n");
}

/**
 * The project context the Tangle UI gives its sessions: a root config that
 * makes every `tangle-deploy` submit carry the project's run annotation, the
 * env that points at it, the selector tag, a note telling Prime so, and the
 * project's shared folder as memory when it has one. The run source is left
 * to the bundle's default on purpose.
 */
export function projectSessionFields(
  project: Project,
  withSharedFolder = true,
): Pick<CreateSessionRequest, "resources" | "env" | "tags" | "memory"> {
  const annotation = `${RUN_ANNOTATION_PREFIX}${project.id}`;
  const annotations = { annotations: { [annotation]: "true" } };
  // JSON is valid YAML, so the config needs no YAML library.
  const rootConfig = JSON.stringify({
    commands: {
      "tangle-deploy pipeline-run submit": annotations,
      "tangle-deploy pipeline-run submit-from-python": annotations,
    },
  });
  const folderId = withSharedFolder ? sharedFolderOf(project) : undefined;
  const fields: ReturnType<typeof projectSessionFields> = {
    resources: [
      {
        kind: "memory",
        scope: "session",
        content: projectNote(project, annotation, Boolean(folderId)),
      },
      { kind: "file", path: ROOT_CONFIG_FILE, content: rootConfig },
    ],
    env: { TANGLE_ROOT_CONFIG: `{{uploadsPath}}/${ROOT_CONFIG_FILE}` },
    tags: [`projectId:${project.id}`],
  };
  if (!folderId) return fields;
  fields.resources?.push({ kind: "mount", folderId, mountName: PROJECT_MOUNT });
  fields.memory = {
    kind: "composite",
    children: [
      { kind: "simple-md", root: `${PROJECT_MOUNT}/NOTES` },
      { kind: "pi-memory", root: `${PROJECT_MOUNT}/pi-memory` },
    ],
  };
  return fields;
}

/** Uses the named project, or creates one named `title` in the named workspace. */
async function pickProject(
  api: string,
  target: ProjectTarget,
  title: string,
  bundleId: string,
  fetchFor: FetchFor,
): Promise<{ project: Project; shellUrl: string }> {
  const tangle = fetchFor(target.tangleUrl);
  if (target.projectId) {
    const url = `${api}/projects/${segment(target.projectId)}`;
    const project = await requestJson<Project>(tangle, url);
    const workspace = await requestJson<Workspace>(
      tangle,
      `${api}/workspaces/${segment(project.workspace_id)}`,
    );
    return { project, shellUrl: shellUrlOf(workspace, target.tangleUrl) };
  }
  const workspace = await findWorkspace(api, target.workspace ?? "", tangle);
  const shellUrl = shellUrlOf(workspace, target.tangleUrl);
  await checkShell(shellUrl, bundleId, fetchFor(shellUrl));
  const project = await requestJson<Project>(tangle, `${api}/projects/`, {
    workspace_id: workspace.id,
    name: title,
    origin: "agent",
  });
  return { project, shellUrl };
}

/**
 * Lists the session in its project. The session is already running, so a
 * failure here only warns: the worker still starts and prints the session id.
 */
async function listInProject(
  url: string,
  resource: object,
  tangle: typeof fetch,
): Promise<string | undefined> {
  try {
    await requestJson(tangle, url, resource);
    return undefined;
  } catch (error) {
    return `the session is not listed in its project: ${(error as Error).message}`;
  }
}

/**
 * Starts a session the way the Tangle UI does: on the project's workspace
 * Shell, with the project's context, then attached to the project so it is
 * listed there.
 */
export async function openProjectSession(
  target: ProjectTarget,
  title: string,
  bundleId: string,
  fetchFor: FetchFor,
): Promise<OpenedSession> {
  const api = `${target.tangleUrl}/api`;
  const { project, shellUrl } = await pickProject(
    api,
    target,
    title,
    bundleId,
    fetchFor,
  );
  const create = (withSharedFolder: boolean) =>
    requestJson<{ session: Session }>(
      fetchFor(shellUrl),
      `${shellUrl}/api/sessions`,
      {
        name: title,
        bundleId,
        ...projectSessionFields(project, withSharedFolder),
      },
    );
  // A stale shared-folder id would fail every start, so retry without it.
  const { session } = await create(true).catch((error: unknown) => {
    if (!sharedFolderOf(project)) throw error;
    return create(false);
  });
  const warning = await listInProject(
    `${api}/projects/${segment(project.id)}/resources/`,
    { entity: "agent_session", entity_id: session.id, name: title },
    fetchFor(target.tangleUrl),
  );
  const projectUrl = `${target.tangleUrl}/projects/${segment(project.id)}`;
  return { session, shellUrl, projectUrl, warning };
}
