import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectTarget } from "./config.ts";
import { openProjectSession, projectSessionFields } from "./project.ts";

const SHELL = "https://tangle.test/shell-1";

interface Call {
  url: string;
  body: unknown;
}

const REPLIES: [RegExp, unknown][] = [
  [
    /\/api\/workspaces\/$/,
    {
      workspaces: [
        { id: "w-0", name: "Test", is_active: false },
        { id: "w-1", name: "Test", data: { tangentBaseUrl: `${SHELL}/` } },
      ],
    },
  ],
  [
    /\/api\/workspaces\/w-1$/,
    { id: "w-1", name: "Test", data: { tangentBaseUrl: SHELL } },
  ],
  [
    /\/api\/workspaces\/w-rel$/,
    { id: "w-rel", name: "Relative", data: { tangentBaseUrl: "/shell-1" } },
  ],
  [
    /\/api\/projects\/p-rel$/,
    { id: "p-rel", name: "Relative", workspace_id: "w-rel" },
  ],
  [
    /\/api\/projects\/$/,
    { id: "p-new", name: "Clean data", workspace_id: "w-1" },
  ],
  [
    /\/api\/projects\/p-1$/,
    { id: "p-1", name: "Ranking", workspace_id: "w-1" },
  ],
  [
    /\/api\/projects\/p-shared$/,
    {
      id: "p-shared",
      name: "Shared",
      workspace_id: "w-1",
      data: { tangentSharedFolderId: "f-1" },
    },
  ],
  [/\/api\/agent-bundles$/, { bundles: [{ id: "tangle" }] }],
  [/\/resources\/$/, { id: "r-1" }],
  [/\/shell-1\/api\/sessions$/, { session: { id: "s-1", name: "Clean data" } }],
];

/** Answers by path and records every call; `failOnce` fails its first match. */
function fakeFetch(calls: Call[], failOnce?: RegExp): typeof fetch {
  let failed = false;
  const shouldFail = (url: string) => {
    const fail = !failed && Boolean(failOnce?.test(url));
    failed ||= fail;
    return fail;
  };
  const respond = (url: string) => {
    const reply = REPLIES.find(([pattern]) => pattern.test(url));
    if (!reply || shouldFail(url)) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify(reply[1]));
  };
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "null")) });
    return respond(url);
  }) as typeof fetch;
}

const target = (fields: Partial<ProjectTarget>): ProjectTarget => ({
  tangleUrl: "https://tangle.test",
  projectId: undefined,
  workspace: undefined,
  ...fields,
});

test("an existing project's session goes on its workspace Shell and is attached", async () => {
  const calls: Call[] = [];
  const fetchImpl = fakeFetch(calls);
  const opened = await openProjectSession(
    target({ projectId: "p-1" }),
    "Runs",
    "tangle",
    () => fetchImpl,
  );
  assert.equal(opened.shellUrl, SHELL);
  assert.equal(opened.projectUrl, "https://tangle.test/projects/p-1");
  const create = calls.find((call) => call.url === `${SHELL}/api/sessions`);
  assert.deepEqual((create?.body as { tags: string[] }).tags, [
    "projectId:p-1",
  ]);
  assert.deepEqual(calls.at(-1), {
    url: "https://tangle.test/api/projects/p-1/resources/",
    body: { entity: "agent_session", entity_id: "s-1", name: "Runs" },
  });
});

test("--workspace creates a project named after the task in that workspace", async () => {
  const calls: Call[] = [];
  const fetchImpl = fakeFetch(calls);
  const opened = await openProjectSession(
    target({ workspace: "test" }),
    "Clean data",
    "tangle",
    () => fetchImpl,
  );
  const created = calls.find((call) => call.url.endsWith("/api/projects/"));
  assert.deepEqual(created?.body, {
    workspace_id: "w-1",
    name: "Clean data",
    origin: "agent",
  });
  assert.equal(opened.projectUrl, "https://tangle.test/projects/p-new");
});

test("an unknown workspace fails before anything is created", async () => {
  const calls: Call[] = [];
  const fetchImpl = fakeFetch(calls);
  await assert.rejects(
    openProjectSession(
      target({ workspace: "Nope" }),
      "a",
      "tangle",
      () => fetchImpl,
    ),
    /No workspace "Nope". Available: Test/,
  );
  assert.equal(calls.length, 1);
});

test("a missing bundle fails before a project is created", async () => {
  const calls: Call[] = [];
  const fetchImpl = fakeFetch(calls);
  await assert.rejects(
    openProjectSession(
      target({ workspace: "Test" }),
      "a",
      "nope",
      () => fetchImpl,
    ),
    /No bundle "nope" on the Shell. Available: tangle/,
  );
  assert.ok(!calls.some((call) => call.url.endsWith("/api/projects/")));
});

test("a project's shared folder is mounted as memory, and dropped if stale", async () => {
  const calls: Call[] = [];
  const fetchImpl = fakeFetch(calls, /\/shell-1\/api\/sessions$/);
  await openProjectSession(
    target({ projectId: "p-shared" }),
    "a",
    "tangle",
    () => fetchImpl,
  );
  const creates = calls
    .filter((call) => call.url === `${SHELL}/api/sessions`)
    .map(
      (call) =>
        call.body as { memory?: unknown; resources: { kind: string }[] },
    );
  const mounts = creates.map((body) =>
    body.resources.some((resource) => resource.kind === "mount"),
  );
  assert.deepEqual(mounts, [true, false]);
  assert.ok(creates[0]?.memory);
});

test("the root config tags every tangle-deploy submit with the project", () => {
  const fields = projectSessionFields({
    id: "p-1",
    name: "Ranking",
    workspace_id: "w-1",
  });
  const [note, file] = (fields.resources ?? []).map((resource) =>
    "content" in resource ? resource.content : "",
  );
  assert.match(note ?? "", /"Ranking" \(id p-1\)/);
  assert.equal(fields.memory, undefined);
  const config = JSON.parse(file ?? "{}");
  const submit = config.commands["tangle-deploy pipeline-run submit"];
  assert.deepEqual(submit.annotations, {
    "tangleml.com/project/id/p-1": "true",
  });
  assert.equal(
    fields.env?.TANGLE_ROOT_CONFIG,
    "{{uploadsPath}}/tangle-deploy-root-config.yaml",
  );
});

test("a Shell address saved as a path is relative to Tangle", async () => {
  const fetchImpl = fakeFetch([]);
  const opened = await openProjectSession(
    target({ projectId: "p-rel" }),
    "Runs",
    "tangle",
    () => fetchImpl,
  );
  assert.equal(opened.shellUrl, SHELL);
});

test("a failed project listing warns instead of stranding the session", async () => {
  const fetchImpl = fakeFetch([], /\/resources\/$/);
  const opened = await openProjectSession(
    target({ projectId: "p-1" }),
    "Runs",
    "tangle",
    () => fetchImpl,
  );
  assert.equal(opened.session.id, "s-1");
  assert.match(opened.warning ?? "", /not listed in its project/);
});
