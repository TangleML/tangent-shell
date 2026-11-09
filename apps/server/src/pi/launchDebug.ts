import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { MemorySourceInfo } from "../memory/types.ts";
import { TANGENT_DIRNAME } from "./config/bundleLoader.ts";
import type { AgentDescriptor } from "./types.ts";

const DEBUG_DIRNAME = "debug";

/** Env keys whose values never land in the dump. */
const SECRET_KEY = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;

/** Multi-line or longer args are shown by size (an inline prompt fallback). */
const MAX_ARG_CHARS = 4000;

/** One labelled piece of the appended system prompt. */
export interface LaunchPromptPart {
  label: string;
  text: string;
}

/** Paths one source contributes to the spawn, e.g. bundle skills. */
export interface LaunchResourceGroup {
  label: string;
  paths: string[];
}

/** Everything one Pi spawn was launched with. */
export interface LaunchDebugInput {
  sessionId: string;
  agentId: string;
  name: string;
  role: AgentDescriptor["role"];
  template?: string;
  restartCount: number;
  cwd: string;
  bin: string;
  model: { provider: string; model: string; thinking: string };
  args: string[];
  env: NodeJS.ProcessEnv;
  /** The server's own env; only keys the spawn adds or changes are dumped. */
  baseEnv: NodeJS.ProcessEnv;
  tools: string[];
  deniedTools: string[];
  resources: LaunchResourceGroup[];
  promptParts: LaunchPromptPart[];
  promptText: string;
  promptFile: string | null;
  memorySources: MemorySourceInfo[];
}

/** Where an agent's launch details are written; overwritten on every spawn. */
export function launchDebugPath(rootPath: string, agentId: string): string {
  return path.join(
    rootPath,
    TANGENT_DIRNAME,
    DEBUG_DIRNAME,
    `pi-launch-${agentId}.md`,
  );
}

/** A code fence longer than any backtick run inside `text`. */
function fenceFor(text: string): string {
  const longest = Math.max(
    0,
    ...[...text.matchAll(/`+/g)].map((run) => run[0].length),
  );
  return "`".repeat(Math.max(4, longest + 1));
}

function fenced(text: string, lang = ""): string {
  const fence = fenceFor(text);
  return `${fence}${lang}\n${text}\n${fence}`;
}

function shellQuote(arg: string): string {
  if (arg.includes("\n") || arg.length > MAX_ARG_CHARS) {
    return `<inline text, ${Buffer.byteLength(arg)} bytes>`;
  }
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

function maskValue(key: string, value: string): string {
  return SECRET_KEY.test(key) ? "***" : value;
}

/** The spawn env entries that differ from the server's own env, masked. */
function addedEnv(input: LaunchDebugInput): string[] {
  return Object.entries(input.env)
    .filter(
      ([key, value]) => value !== undefined && input.baseEnv[key] !== value,
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${maskValue(key, value ?? "")}`);
}

function list(items: readonly string[]): string {
  return items.length
    ? items.map((item) => `- \`${item}\``).join("\n")
    : "(none)";
}

function headerSection(input: LaunchDebugInput, now: Date): string[] {
  return [
    `# Pi launch: ${input.name} (${input.agentId})`,
    "",
    `- Session: \`${input.sessionId}\``,
    `- Role: ${input.role}${input.template ? ` (template \`${input.template}\`)` : ""}`,
    `- Spawned: ${now.toISOString()}`,
    `- Restarts: ${input.restartCount}`,
    `- Binary: \`${input.bin}\``,
    `- Working directory: \`${input.cwd}\``,
    `- Model: \`${input.model.provider}/${input.model.model}\`, thinking \`${input.model.thinking}\``,
  ];
}

function commandSection(input: LaunchDebugInput): string[] {
  const command = [input.bin, ...input.args.map(shellQuote)].join(" \\\n  ");
  return ["## Command", "", fenced(command, "sh")];
}

function toolsSection(input: LaunchDebugInput): string[] {
  return [
    "## Tools",
    "",
    list(input.tools),
    "",
    "Memory tools denied to this role:",
    "",
    list(input.deniedTools),
  ];
}

function resourcesSection(input: LaunchDebugInput): string[] {
  const groups = input.resources.flatMap((group) => [
    `### ${group.label}`,
    "",
    list(group.paths),
    "",
  ]);
  return ["## Resources", "", ...groups];
}

function envSection(input: LaunchDebugInput): string[] {
  const entries = addedEnv(input);
  return [
    "## Env",
    "",
    "Variables the spawn adds to or changes from the server's env; secrets are masked.",
    "",
    entries.length ? fenced(entries.join("\n"), "sh") : "(none)",
  ];
}

function sourceLine(source: MemorySourceInfo): string {
  const digest = source.digest
    ? `${source.digest.mode}, ${source.digest.entries} entries, ${source.digest.chars} chars`
    : "no digest";
  return `| ${source.title} | ${source.scope} | ${digest} |`;
}

function memorySection(input: LaunchDebugInput): string[] {
  if (input.memorySources.length === 0) return ["## Memory", "", "(none)"];
  return [
    "## Memory",
    "",
    "| Source | Scope | Digest |",
    "| --- | --- | --- |",
    ...input.memorySources.map(sourceLine),
    "",
    fenced(JSON.stringify(input.memorySources, null, 2), "json"),
  ];
}

function promptSection(input: LaunchDebugInput): string[] {
  const parts = input.promptParts.map(
    (part) => `| ${part.label} | ${Buffer.byteLength(part.text.trim())} |`,
  );
  return [
    "## Appended system prompt",
    "",
    `File: ${input.promptFile ? `\`${input.promptFile}\`` : "(none)"}`,
    "",
    "| Part | Bytes |",
    "| --- | --- |",
    ...parts,
    `| Total | ${Buffer.byteLength(input.promptText)} |`,
    "",
    input.promptText ? fenced(input.promptText, "markdown") : "(empty)",
  ];
}

/** The launch details as markdown. */
export function renderLaunchDebug(
  input: LaunchDebugInput,
  now = new Date(),
): string {
  return [
    ...headerSection(input, now),
    "",
    ...commandSection(input),
    "",
    ...toolsSection(input),
    "",
    ...resourcesSection(input),
    ...envSection(input),
    "",
    ...memorySection(input),
    "",
    ...promptSection(input),
    "",
  ].join("\n");
}

/**
 * Writes the launch details under the session's `.tangent/debug/` and returns
 * the file path, or `undefined` when the write fails (never blocking a spawn).
 */
export function writeLaunchDebug(input: LaunchDebugInput): string | undefined {
  const file = launchDebugPath(input.cwd, input.agentId);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, renderLaunchDebug(input));
    return file;
  } catch (err) {
    console.warn(
      `[pi:${input.sessionId}:${input.agentId}] failed to write launch details:`,
      err,
    );
    return undefined;
  }
}
