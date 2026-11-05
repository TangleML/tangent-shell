---
name: tangent-prime-worker
description: Hand work to a Tangent session's Prime agent as a herdr worker pane, while you stay the orchestrator. Use inside herdr when the user asks to use Tangent or Prime, to "start a Tangent session", or for Tangle work that needs Tangent (Tangle projects, pipelines, runs, data) and they want it delegated. Prime does the work on the Tangent Shell, signed in as the user.
---

# Tangent Prime as a herdr worker

You are the orchestrator. Prime runs on the Tangent Shell with its tools and
data; a local pane only relays messages and signs in as the user, so the session
is theirs. Prime cannot see this machine: every bit of context it needs must be
in the messages you send.

`<worker>` below is `<skill-dir>/scripts/tangent-prime-worker.mjs`, where
`<skill-dir>` is the folder that contains this file.

## Before you start

- Only inside herdr: `HERDR_ENV` must be `1`. If not, tell the user this skill
  needs herdr and stop.
- New sessions go in a Tangle project, so they are listed there and the
  user can open them from the project page. You need the Tangle URL
  (`$TANGLE_URL`, or a project link the user pasted) and a place:
  - **The user named or linked a project:** `--project <id|link>`, even if
    someone else owns it.
  - **New work** (a pipeline or workflow to build): `--workspace <name>`. This
    creates a project named after the title. Use the workspace the user named,
    else `$TANGENT_WORKSPACE`; if neither is set, ask once. A wrong workspace
    name makes the worker list the real ones. Tell the user you created a project.
  - **A quick question about existing work:** ask which project it belongs to
    rather than creating one. If you think you know, propose it and confirm
    first; never attach to a guessed project unconfirmed.
- A session URL the user pasted is joined with `--session` instead.
- The worker signs in through the Shell's SSO when needed. If it fails to sign
  in, show the user its error line. Never handle tokens yourself. If it exits
  with "lost the Shell connection", restart it; that re-runs sign-in.

## 1. Reuse or start a worker

`herdr agent list` shows existing workers; a Tangent one has `"agent":"tangent"`.
Reuse it if it is working on the same task. Otherwise:

1. Open a pane next to yours, without taking the user's focus. Split right if
   your pane is wide (`herdr pane layout --pane "$HERDR_PANE_ID"`: width more
   than about 2.5 × height), otherwise down:
   `herdr pane split --current --direction <right|down> --no-focus --cwd "$PWD"`
   Note the new `pane_id` (`.result.pane.pane_id`). Use a pane, not a new tab,
   unless the user asks for one.
2. Start the worker in it, with a short title for the task:
   `herdr pane run <pane> '<worker> --new "<title>" --project <link>'`, or
   `'<worker> --new "<title>" --workspace <name> --tangle <tangle url>'`
   (`--tangle` can be left out when `$TANGLE_URL` is set), or, to continue a
   session: `'<worker> --session <id|url>'`.
3. `herdr agent wait <pane> --until idle --timeout 60000`, then
   `herdr pane read <pane> --lines 20`. It prints the `session <id>`,
   the `project <link>` and the `replies <path>` file. If it printed
   `tangent-prime-worker: …` instead, it failed: tell the user that line and stop.

Tell the user the session id and project link; the session is theirs and is
listed in that project in Tangle.

## 2. Give Prime a task

- **One line:** `herdr pane run <pane> "<message>"`. The text is typed and
  Enter is pressed, so it must not contain newlines.
- **Longer or multi-line:** write it to a temp file, then
  `herdr pane run <pane> "/file <path>"`. The worker sends the file's contents
  as one message (max about 900 KB). `/file` is for task text only: Prime runs
  on the server and cannot read local files.

Write it like a brief for a colleague: the goal, the relevant ids, constraints,
and what you want back.

## 3. Wait for Prime and read the reply

1. `herdr agent wait <pane> --until working --timeout 15000`. A timeout here
   means the message did not go through: read the pane and `last-reply.md`.
2. `herdr agent wait <pane> --until idle --timeout 600000`. Prime can take
   minutes. On timeout it is still working: wait again, or check on it with
   `herdr pane read <pane> --lines 30`.
3. After idle, always read Prime's full reply from the `replies` file
   (`last-reply.md`), the only file written (no transcript). Prefer it over the
   screen, which wraps long lines. If Prime never started, the worker writes
   "Prime error: the message was not accepted" there itself.

Do not send a new message while the worker is `working`; wait first. To stop
Prime's current run, `herdr pane send-keys <pane> ctrl+c`.

## 4. Finish

Report Prime's result to the user in your own words, then ask whether to close
the worker pane. If they agree, `herdr pane send-keys <pane> ctrl+d`, then
`herdr pane close <pane>`. The session stays on the Shell; reattach later
with `--session`.

## Rules

- Never print or paste tokens or cookies.
- One worker per task; ask before closing it. Do not attach to sessions the user did not start or name.
- Prime acts as the user. Ask the user before giving Prime a task that changes
  things (submitting runs, editing projects), unless they already asked for it.
