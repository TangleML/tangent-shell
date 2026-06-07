// @ts-nocheck
/**
 * Custom tool extension shipped with the skill-builder bundle.
 *
 * Like the research-assistant bundle's `citations.ts`, this file is authored
 * against Pi's extension runtime (it imports modules Pi resolves when loading
 * extensions, e.g. `typebox`), not against this repo's `node_modules`. It is
 * excluded from the repo type-check (`@ts-nocheck`) and is never imported by
 * the server; it is only passed as a `--extension` path to the per-session Pi
 * subprocess, which loads it with jiti.
 *
 * It registers a single `package_bundle` tool that validates a Tangent
 * Configuration Bundle source folder and packages it into `<id>.zip` by
 * shelling out to the system `zip` binary (declared under `software` in
 * `tangent.yaml`).
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function textResult(text: string) {
  return { content: [{ type: "text", text }], details: {} };
}

/** Skip OS junk and any dotfile/dotdir, matching scripts/pack-bundle.mjs. */
function shouldSkip(name: string): boolean {
  return name === ".DS_Store" || name.startsWith(".");
}

/**
 * Recursively collect regular files under `dir` as POSIX-relative paths from
 * `root`. Rejects entries that would escape `root`.
 */
function collectFiles(root: string, dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;

    const absolute = join(dir, entry.name);
    const rel = relative(root, absolute);
    if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
      throw new Error(`refusing to pack entry outside the source root: ${rel}`);
    }

    if (entry.isDirectory()) {
      collectFiles(root, absolute, out);
    } else if (entry.isFile()) {
      out.push(rel.split(sep).join("/"));
    }
  }
  return out;
}

/** Read a top-level scalar (`key: value`) from a simple YAML manifest. */
function readScalar(yaml: string, key: string): string | undefined {
  const match = yaml.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"));
  if (!match) return undefined;
  return match[1].replace(/^["']|["']$/g, "").trim();
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "package_bundle",
    label: "Package Bundle",
    description:
      "Validate a Tangent Configuration Bundle source folder and package it " +
      "into <id>.zip. Use this as the final step after authoring skills and " +
      "assembling tangent.yaml to produce the installable bundle archive.",
    promptSnippet: "Validate and zip a bundle source folder into <id>.zip",
    parameters: Type.Object({
      sourceDir: Type.String({
        description:
          "Path to the bundle source folder containing tangent.yaml and " +
          "prompts/prime.md.",
      }),
      outputPath: Type.Optional(
        Type.String({
          description:
            "Optional output zip path. Defaults to <id>.zip beside the " +
            "source folder, where <id> comes from tangent.yaml.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const sourceDir = resolve(params.sourceDir);

      if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
        throw new Error(`source is not a directory: ${sourceDir}`);
      }

      const manifestPath = join(sourceDir, "tangent.yaml");
      if (!existsSync(manifestPath)) {
        throw new Error(`missing required manifest: ${manifestPath}`);
      }
      const manifest = readFileSync(manifestPath, "utf8");

      const schemaVersion = readScalar(manifest, "schemaVersion");
      if (schemaVersion !== "1") {
        throw new Error(
          `tangent.yaml schemaVersion must be 1 (got ${schemaVersion ?? "none"})`,
        );
      }

      const id = readScalar(manifest, "id");
      if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        throw new Error(
          `tangent.yaml "id" must be a slug matching ^[a-z0-9][a-z0-9-]*$ ` +
            `(got ${id ?? "none"})`,
        );
      }

      if (!existsSync(join(sourceDir, "prompts", "prime.md"))) {
        throw new Error("missing required prompts/prime.md");
      }

      const files = collectFiles(sourceDir, sourceDir, []).sort();
      if (files.length === 0) {
        throw new Error(`no files found to pack in ${sourceDir}`);
      }

      const outputPath = params.outputPath
        ? resolve(params.outputPath)
        : resolve(dirname(sourceDir), `${id}.zip`);

      // Recreate from scratch so stale entries never linger.
      if (existsSync(outputPath)) unlinkSync(outputPath);

      // `-r` recurse, `-X` strip extra file attrs, exclude dotfiles/OS junk.
      execFileSync(
        "zip",
        ["-r", "-X", "-q", outputPath, ".", "-x", "*/.*", ".*", "*/.DS_Store"],
        { cwd: sourceDir },
      );

      const rel = isAbsolute(params.sourceDir)
        ? outputPath
        : relative(process.cwd(), outputPath);
      const list = files.map((f) => `  ${f}`).join("\n");
      return textResult(
        `Packaged ${files.length} files from ${sourceDir}\n` +
          `-> ${rel}\n${list}`,
      );
    },
  });
}
