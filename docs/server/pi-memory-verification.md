# pi-memory Verification Procedure (embedded-mode / third-party host)

[< Back to index](./index.md)

A black-box verification procedure a **third-party host app** can implement to
confirm that a Tangent instance has pluggable **pi-memory** working end to end —
including **multi-session shared memory**. It drives only the public surfaces an
embed host already uses: the REST API (`/api/*`) and the Socket.IO chat channel.
It does **not** assume filesystem access to the server.

Related background: [memory.md](./memory.md),
[sessions-and-storage.md](./sessions-and-storage.md), and the memory binding
contract in [`packages/shared/src/contracts.ts`](../../packages/shared/src/contracts.ts)
(`MemoryBinding`, `PiMemoryConfig`, `CreateSessionRequest`).

---

## 0. What you are verifying

Memory is **pluggable** and is an attribute of the **session**, not of any
folder. Each session resolves to the always-on `SimpleMdMemory` store, optionally
joined with the session's own `MemoryBinding`:

```ts
type MemoryBinding =
  | { kind: "simple-md"; root?: string }
  | { kind: "pi-memory"; root?: string; config?: PiMemoryConfig }
  | { kind: "composite"; children: MemoryBinding[] };
```

- A binding is supplied either by the **agent bundle default** (`memoryBinding` in
  its manifest) or by the **create request** (`CreateSessionRequest.memory`),
  which overrides the bundle. The resolved value is persisted on the session.
- `root` is a **session-root-relative POSIX path** for the store directory. Omit
  it → the store is **local** to the session. Point it at a **mounted shared
  folder** (`"<mountName>/…"`) → the store is **shared** across every session that
  mounts the folder. A shared folder is just a mount point; the binding is what
  decides to use it.
- `pi-memory` leaves use the [`@tobilu/qmd`](https://github.com/tobi/qmd) CLI for
  `memory_search`. Writes/reads/scratchpad work without qmd; **search and the
  background index need qmd on the server process's `PATH`**. Each store has
  its own qmd index and collection config, kept in server-owned state under
  `QMD_STATE_ROOT` (not inside the store), so sessions sharing a store share
  its index and unrelated stores never see each other. A binding may only
  resolve into the session root or a folder the session mounted. If a
  project-local `.qmd/index.yml` exists at or above the session root, qmd would
  prefer it, so the server leaves pi-memory out of every spawn while it
  exists; make sure none exists there. `SESSIONS_ROOT`, `SHARED_ROOT` and
  `QMD_STATE_ROOT` must be disjoint, or the server won't start.

> **Hosts that ran an earlier build:** before per-store indexes, every pi-memory
> session searched one global qmd collection, so searches could return another
> store's files (e.g. a daily log that isn't in this session's store). That
> global state — the `pi-memory` collection in `~/.config/qmd/index.yml` and
> `~/.cache/qmd/index.sqlite` of the server's user — is no longer read and is
> safe to delete.

- A binding holds **at most one** `pi-memory` leaf. Only Prime writes: sub-agents
  get `memory_read` / `memory_search` / `memory_status`, and write no exit
  summaries.

The procedure below verifies, in order: the environment preflight (qmd), a
single-session round-trip, a **two-session shared** round-trip, the config knobs,
a path-safety negative case, and the no-binding fallback.

---

## 1. Prerequisites (instance side)

These are host-operator responsibilities; the verification will surface them if
missing, but set them up first for a green run.

| Requirement                | How to satisfy                                                                                                                                                                                        | Why                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qmd` on the server `PATH` | `npm install -g @tobilu/qmd@2.8.3` (the version the Docker images pin), and ensure the global bin dir is on the **service** PATH (systemd/docker/pm2 env, not just your shell)                        | The Pi child inherits the server's `process.env` (including `PATH`); `sanitizeSessionEnv` strips `PATH` from per-session env, so qmd must be visible to the server process. |
| A pi-memory-capable bundle | Any installed agent bundle; the binding can come from the create request so the bundle need not declare one                                                                                           | Session creation requires a `bundleId`.                                                                                                                                     |
| Embed CORS                 | Set `EMBED_ALLOWED_ORIGINS` to include your host app's origin                                                                                                                                         | REST + the Socket.IO handshake are gated by this allowlist.                                                                                                                 |
| Base URL / auth            | `BASE_URL` (default `http://localhost:8787`); send your embed bearer `Authorization` header (or Oktasso cookie) if the instance enforces auth — otherwise calls resolve to the anonymous default user | All `/api/*` calls and the socket handshake.                                                                                                                                |

> qmd is **optional** by design. If it is absent, `memory_write` / `memory_read`
> still work; only `memory_search` and background indexing are unavailable. The
> preflight (§3) tells you which state you are in.

---

## 2. Surfaces the host app uses

**REST** (JSON over `BASE_URL`):

| Call                                        | Purpose                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /api/agent-bundles`                    | pick a `bundleId` (`{ bundles: AgentBundleMeta[] }`)                        |
| `POST /api/shared-folders` `{ name? }`      | create a shared folder → `{ folder: { id, name, … } }`                      |
| `GET /api/shared-folders`                   | list folders                                                                |
| `POST /api/sessions` `CreateSessionRequest` | create a session (bundle + resources + **memory**) → `{ session: Session }` |
| `GET /api/sessions/:id`                     | read a session back                                                         |
| `DELETE /api/sessions/:id`                  | tear down                                                                   |
| `GET /api/global-memory`                    | read global memory (cross-session SimpleMD)                                 |

**Socket.IO** (default path `/socket.io`) — how the host talks to Prime and reads
replies:

- Emit `chat:join` `{ sessionId }` → receive `chat:history`.
- Emit `chat:message` `{ sessionId, content }` (author is resolved server-side;
  target defaults to Prime).
- Receive the reply stream: `agent:start` → `agent:delta` (content chunks) →
  `agent:end`. Errors arrive on `agent:error`.
- `memory:suggestion` / `memory:confirm` / `memory:dismiss` are the SimpleMD
  suggestion flow (Prime-authored). **pi-memory tools run inside the Pi process
  and emit no server highlight**, so pi-memory assertions are made on the agent's
  **reply text** (§ "How to assert on an agent-owned store").

Event names are the string values of `SocketEvents` in the contracts file.

### How to assert on an agent-owned store

Because pi-memory curates itself inside the Pi process, the host cannot observe a
server-side write event. Verify by **instruction + read-back** within the agent:

1. Send a prompt that instructs Prime to persist a **unique token** via
   `memory_write` (generate a random marker per run, e.g. `VERIFY-<uuid>`).
2. In a later turn (or a later session), instruct Prime to `memory_search` /
   `memory_read` for that token and **echo the result verbatim**.
3. Assert the marker appears in the `agent:delta`/`agent:end` text.

Keep prompts explicit and deterministic (name the tool, name the marker, ask for
a verbatim echo) so the assertion is a simple substring check, not NLP.

---

## 3. Preflight: is qmd available?

**Goal:** classify the instance as _pi-memory with search_ vs _pi-memory without
search_ before running the memory cases.

1. Create a throwaway session with a **session-local pi-memory** binding:

   ```http
   POST /api/sessions
   Content-Type: application/json

   {
     "name": "verify-preflight",
     "bundleId": "<bundleId>",
     "memory": { "kind": "pi-memory" }
   }
   ```

2. `chat:join`, then `chat:message`:

   > Run the `memory_status` tool and report, verbatim, whether qmd is installed
   > and whether the `pi-memory` collection exists. Do not do anything else.

3. **Assert:** the reply states qmd is available and a collection is configured
   (the extension auto-creates the `pi-memory` collection on first session start).

**Outcomes**

- Reports qmd available → run **all** cases below.
- Reports qmd missing → §1 is unmet. Core write/read cases (§4 steps for write &
  read) still pass; **skip search-dependent assertions** and the shared-search
  case, and flag the instance as "memory without search".

Tear down the session (`DELETE /api/sessions/:id`).

---

## 4. Case A — single session, session-local pi-memory

**Goal:** a write persists and is retrievable within one session.

1. Create session with `"memory": { "kind": "pi-memory" }` (store defaults to
   `.pi-memory/` under the session root — private to this session).
2. Mint a unique marker `M = "VERIFY-" + uuid`.
3. `chat:message`:

   > Use `memory_write` to permanently record this exact fact: "`<M>` is the
   > canonical verification marker for project Acme." Confirm you wrote it.

   Await `agent:end`.

4. `chat:message`:

   > Use `memory_read` (and `memory_search` if available) to find the canonical
   > verification marker for project Acme, and reply with the exact marker string.

**Pass:** the step-4 reply contains `M`.
**Search sub-assertion (qmd only):** ask explicitly for `memory_search "<M>"`
and confirm it returns the stored line.

Tear down.

---

## 5. Case B — multi-session **shared** pi-memory (the key case)

**Goal:** a fact written by session #1 is recalled by a **different** session #2
because both point their pi-memory `root` into the **same mounted shared folder**.

### B.1 Create the shared folder

```http
POST /api/shared-folders
{ "name": "verify-shared-memory" }
```

Keep `folder.id` → `FID`.

### B.2 Create session #1 (writer) mounting the folder and binding memory into it

```http
POST /api/sessions
{
  "name": "verify-shared-1",
  "bundleId": "<bundleId>",
  "resources": [
    { "kind": "mount", "folderId": "<FID>", "mountName": "project" }
  ],
  "memory": { "kind": "pi-memory", "root": "project/pi-memory" }
}
```

- The mount symlinks the shared folder to `<sessionRoot>/project`.
- `root: "project/pi-memory"` resolves (relative to the session root, through the
  symlink) to `SHARED_ROOT/<FID>/pi-memory` — the **shared** store.
- Order matters and is handled server-side: resources are seeded (the mount
  symlink exists before the request continues), then the binding is settled and
  persisted, then memory is resolved and its dir created — so the store lands
  inside the mount.
- The mount must be part of **this create request**. If the binding's top-level
  folder doesn't exist at creation (no such mount, or its shared folder is
  missing on disk), pi-memory is dropped from the stored binding and the session
  is SimpleMD-only for good; mounting the folder later does not turn it on.

### B.3 Write in session #1

Mint `M = "VERIFY-" + uuid`. Join session #1 and `chat:message`:

> Use `memory_write` to permanently record: "Shared-project decision `<M>`: the
> API base path is /v2." Confirm the write.

Await `agent:end`. (Optional: prompt "end the session summary now" is not
required; the write is immediate.)

### B.4 Create session #2 (reader) mounting the **same** folder with the same binding

```http
POST /api/sessions
{
  "name": "verify-shared-2",
  "bundleId": "<bundleId>",
  "resources": [
    { "kind": "mount", "folderId": "<FID>", "mountName": "project" }
  ],
  "memory": { "kind": "pi-memory", "root": "project/pi-memory" }
}
```

### B.5 Read in session #2

Join session #2 and `chat:message`:

> Use `memory_search` (or `memory_read`) to find the shared-project decision and
> reply with the exact marker string and the API base path you find.

**Pass (qmd available):** the session #2 reply contains `M` **and** `/v2`, proving
the store written by #1 is visible to #2.
**Pass (qmd absent):** `memory_read` of the shared markdown still surfaces `M`
(search assertion skipped).

### B.6 Isolation control (negative)

Create session #3 with a **session-local** binding (`"memory": { "kind":
"pi-memory" }`, no mount, no `root`) and repeat the §B.5 read prompt.

**Pass:** session #3 does **not** find `M` — confirming the shared store is scoped
to the mount, not leaking into unrelated sessions.

### B.7 Symlink redirect control (negative)

A symlink planted inside a shared folder must not redirect another session's
store. In session #1, `chat:message`:

> Using your shell, run exactly `ln -s /tmp project/redirect` and confirm.

Then create session #4 mounting the **same** folder with
`"memory": { "kind": "pi-memory", "root": "project/redirect" }` and ask Prime
to list its available `memory_*` tools.

**Pass:** session #4 spawns with baseline SimpleMD memory and **no** pi-memory
tools. The server logs `resolves through a symlink … outside the session and
its mounted folders`. The same holds for a link to another shared folder
that session #4 didn't mount (e.g. `ln -s "$SHARED_ROOT/<otherFolderId>"
project/redirect`).

Tear down sessions #1–#4; the shared folder may be reused or left in place.

---

## 6. Case C — config knobs

**Goal:** `PiMemoryConfig` reaches the extension.

1. **Search disabled.** Create a session with:

   ```json
   "memory": { "kind": "pi-memory", "config": { "search": false } }
   ```

   Prompt Prime to `memory_search`. **Pass:** Prime reports the search tool is not
   available to it (the allowlist drops `memory_search`; env `PI_MEMORY_NO_SEARCH=1`).

2. **qmd update off.** `"config": { "qmdUpdate": "off" }` — a smoke check that the
   session still spawns and `memory_write`/`memory_read` round-trip (no background
   indexing). **Pass:** write/read succeed; no error on spawn.

---

## 7. Case D — composite binding

**Goal:** a composite layers a human-readable note with searchable pi-memory.

```json
"memory": {
  "kind": "composite",
  "children": [
    { "kind": "simple-md", "root": "project/NOTES" },
    { "kind": "pi-memory", "root": "project/pi-memory" }
  ]
}
```

(With the same `mount` of a shared folder as `project`.)

**Pass:**

- Before anyone writes it, the agent's standing context says no project memory
  note exists yet and to create `project/NOTES/MEMORY.md` with its file tools
  (the `simple-md` leaf's preamble). After the agent creates it, a new spawn's
  context says the note is at `project/NOTES/MEMORY.md` and embeds its text.
- The pi-memory guidance names the store as `project/pi-memory/` and states
  that pi-memory's tools report it by its canonical path (the shared folder's
  real path) — both name the same files.
- `memory_write`/`memory_search` (pi-memory leaf) behave as in Case B.

---

## 8. Case E — path-safety negative test

**Goal:** a `root` that escapes the session root is rejected, degrading to the
always-on SimpleMD store rather than writing outside the sandbox.

Create a session with a deliberately malicious `root`:

```json
"memory": { "kind": "pi-memory", "root": "../escape" }
```

**Pass:** the session still spawns; Prime has the baseline SimpleMD memory but
**no** pi-memory tools (`memory_write`/`memory_search` absent). The server logs
`[memory] ignoring invalid memory binding`. No directory is created outside the
session root.

The same degradation applies to `"root": "."` (the session root itself, whose
`MEMORY.md` is SimpleMD's session memory). A composite with two `pi-memory`
leaves is rejected by the create request's validation (400).

---

## 9. Case F — no binding (fallback)

**Goal:** a session with no override and a bundle that declares none uses
SimpleMD only.

Create a session with **no** `memory` field (and a bundle without a
`memoryBinding`). Prompt Prime to `read_memory`.

**Pass:** `read_memory` works (session + global markdown); the pi-memory
`memory_*` tools are **not** offered. Optionally confirm cross-session global
memory via `GET /api/global-memory`.

---

## 10. Pass/fail matrix

| Case               | Precondition              | Pass criterion                                                   |
| ------------------ | ------------------------- | ---------------------------------------------------------------- |
| Preflight (§3)     | —                         | `memory_status` reports qmd + collection present                 |
| A — local (§4)     | pi-memory bind            | marker round-trips in one session                                |
| B — shared (§5)    | mount + `root` into mount | marker in #1 read in #2; absent in #3; symlinked #4 rejected     |
| C — knobs (§6)     | config set                | `search:false` removes search; `qmdUpdate:off` still round-trips |
| D — composite (§7) | composite bind            | note preamble present **and** pi-memory search works             |
| E — escape (§8)    | bad `root`                | binding ignored; baseline SimpleMD only; no external write       |
| F — fallback (§9)  | no binding                | SimpleMD only; no pi-memory tools                                |

Cases A/B/D's **search** sub-assertions require qmd. If the preflight reports qmd
missing, mark those `N/A (no qmd)` rather than failing.

---

## 11. Troubleshooting

| Symptom                                 | Likely cause                                                                                                                                                                                        | Fix                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory_status` says qmd not installed  | `qmd` not on the **server** PATH                                                                                                                                                                    | Install `@tobilu/qmd`; put the global bin dir on the service PATH; restart the server.                                                                                                                                                                                                            |
| Search empty right after a write        | Background index not yet refreshed, or `qmdUpdate:"off"`/`"manual"`                                                                                                                                 | Use `memory_read` for the immediate assertion; allow a short delay for background indexing, or trigger a manual embed.                                                                                                                                                                            |
| Session #2 cannot see #1's fact         | `root` not pointing into the mount, or different `mountName`/`folderId`                                                                                                                             | Ensure both sessions mount the **same** `folderId` and use the **same** `root` (`"<mountName>/pi-memory"`).                                                                                                                                                                                       |
| No reply stream on socket               | Not joined, or CORS/handshake rejected                                                                                                                                                              | Emit `chat:join` first; add your origin to `EMBED_ALLOWED_ORIGINS`.                                                                                                                                                                                                                               |
| 404 on create                           | Unknown `bundleId`                                                                                                                                                                                  | Pick an id from `GET /api/agent-bundles`.                                                                                                                                                                                                                                                         |
| Search returns files from another store | Server not on a build with per-store qmd indexes, or a Pi started by an earlier build                                                                                                               | Deploy the current build and restart every Pi. On hosts that ran the earlier build, remove the stale global collection (`qmd collection remove pi-memory`; its index lives in `~/.cache/qmd/index.sqlite`). New spawns never read it, but it explains cross-session hits seen before the upgrade. |
| pi-memory tools missing unexpectedly    | `root` rejected by the path guard (incl. a symlink out of the allowed folders), `root` points into a mount not seeded at create, a `.qmd/index.yml` at or above the session root, or `search:false` | Check server logs for `dropping pi-memory`, `ignoring invalid memory binding`, or `qmd would use the project-local config`; seed the mount in the create request; remove the stray `.qmd/`.                                                                                                       |

---

## 12. Appendix — minimal end-to-end sketch

Pseudo-flow a host app implements (auth header omitted; add if required):

```
# pick a bundle
GET  {BASE_URL}/api/agent-bundles            -> bundleId

# shared folder
POST {BASE_URL}/api/shared-folders {name}    -> FID

# writer session
POST {BASE_URL}/api/sessions {
  bundleId, resources:[{kind:"mount",folderId:FID,mountName:"project"}],
  memory:{kind:"pi-memory",root:"project/pi-memory"}
}                                            -> sid1

# socket: write
connect {BASE_URL}/socket.io
emit chat:join {sessionId: sid1}
emit chat:message {sessionId: sid1, content: "memory_write ... VERIFY-<uuid> ..."}
await agent:end

# reader session (same folder + root)
POST {BASE_URL}/api/sessions { bundleId, resources:[mount FID], memory:{pi-memory root} } -> sid2
emit chat:join {sessionId: sid2}
emit chat:message {sessionId: sid2, content: "memory_search VERIFY-<uuid>, echo verbatim"}
await agent:end                              -> assert text contains VERIFY-<uuid>

# cleanup
DELETE {BASE_URL}/api/sessions/{sid1}
DELETE {BASE_URL}/api/sessions/{sid2}
```
