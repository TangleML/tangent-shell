# The `ui:` manifest block

A bundle declares its UI components in an optional `ui:` block in `tangent.yaml`.
This block is the contract between the author, the server compiler (Phase 3), and
the host (Phases 5-6). Component source lives under the conventional `ui/`
directory (a new entry in `BUNDLE_DIRS`, added in Phase 2).

For the rest of the manifest (metadata, `prime`, entity lists, `software`), see
[`../config-bundle-format.md`](../config-bundle-format.md). The machine-readable
counterparts are [`shared/configBundle.ts`](../../shared/configBundle.ts) (types +
constants) and the zod validator in
[`server/src/pi/config/manifest.ts`](../../server/src/pi/config/manifest.ts).

## Shape

```yaml
ui:
  components:
    - name: pipeline-progress # referenced from agent markdown
      kind: message # rendered from agent output
      entry: ui/pipeline-progress.tsx
    - name: launch-experiment
      kind: panel # proactive input surface
      entry: ui/launch-experiment.tsx
      title: New experiment # shown on the launcher button
```

## Fields

`ui` (optional) — when present, `ui.components` is authoritative.

`ui.components[]` — array of component declarations:

| Field   | Required | Rule                         | Purpose                                                                                               |
| ------- | -------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `name`  | yes      | slug, `^[a-z0-9][a-z0-9-]*$` | Stable id. For `message`, the value after `tangent-ui:` in the agent token. Unique within the bundle. |
| `kind`  | yes      | enum: `message` \| `panel`   | Which surface (see [`README.md`](README.md)).                                                         |
| `entry` | yes      | safe relative path           | Path to the component source, conventionally under `ui/`.                                             |
| `title` | no       | non-empty string             | Display label for `panel` launcher buttons. Ignored for `message`.                                    |

### Validation rules

These mirror the existing manifest validator and are added to the zod schema in
[`manifest.ts`](../../server/src/pi/config/manifest.ts) in Phase 2:

- **`name`** uses the same slug regex as the bundle `id`
  (`^[a-z0-9][a-z0-9-]*$`). Component `name` values must be **unique** within a
  bundle (collisions are rejected).
- **`kind`** is a `z.enum(["message", "panel"])`; any other value is rejected.
- **`entry`** uses the existing `safePath` refinement: a non-empty,
  bundle-relative POSIX path with no `..` traversal and no absolute/drive prefix.
  Existence inside the zip is checked at compile time (Phase 3), not here.
- **`title`** is an optional non-empty string.
- The compile-time guard `_schemaMatchesContract` in `manifest.ts` keeps the zod
  output assignable to `BundleManifest`; the `ui` field must be added to both in
  the same change so they cannot drift.

Validation errors surface in the existing flat-list format
(`tangent.yaml: "ui.components.0.kind" <message>`), collecting every issue in one
pass via `safeParse`.

## Component metadata exposure

So the marketplace and frontend can tell that a bundle has UI (and list its
panels), the compiled component list is surfaced on `AgentBundleMeta` in
[`shared/contracts.ts`](../../shared/contracts.ts) (Phase 2/3). Each entry mirrors
the declared `name`, `kind`, and `title`. This lets the composer render panel
launchers without downloading the bundle zip.

## Worked example

A bundle with one message component and one panel:

```yaml
schemaVersion: 1
id: tangent-ml-agent
name: Tangent ML Agent
version: 1.2.0
prime:
  systemPrompt: prompts/prime.md

ui:
  components:
    - name: pipeline-progress
      kind: message
      entry: ui/pipeline-progress.tsx
    - name: launch-experiment
      kind: panel
      entry: ui/launch-experiment.tsx
      title: New experiment
```

### Rejected examples

```yaml
# rejected: kind not in enum
ui:
  components:
    - name: foo
      kind: widget
      entry: ui/foo.tsx
```

```yaml
# rejected: entry escapes the bundle (unsafe path)
ui:
  components:
    - name: foo
      kind: message
      entry: ../../etc/passwd
```

```yaml
# rejected: name is not a slug
ui:
  components:
    - name: Pipeline_Progress
      kind: message
      entry: ui/foo.tsx
```
