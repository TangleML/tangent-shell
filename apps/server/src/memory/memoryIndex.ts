import type {
  AgentRole,
  MemoryAccess,
  MemorySourceInfo,
  MemorySourceScope,
} from "./types.ts";

const SCOPE_LABELS: Record<MemorySourceScope, string> = {
  session: "this session only",
  global: "every session",
  project: "this project",
  bundle: "every session of this bundle",
  unavailable: "unavailable",
};

function roleRules(role: AgentRole): string[] {
  if (role === "prime") {
    return [
      "Change memory only through the write paths listed for each source, and",
      "never claim to have stored something you did not actually write.",
    ];
  }
  return [
    "Memory is read-only for you: report durable learnings to Prime instead",
    "of trying to store them.",
  ];
}

function accessText(access: MemoryAccess): string {
  if ("file" in access) return `your file tools on \`${access.file}\``;
  return access.tools.map((tool) => `\`${tool}\``).join(", ");
}

function sourceLines(source: MemorySourceInfo): string[] {
  const parts = [
    `- **${source.title}** (${SCOPE_LABELS[source.scope]}): ${source.holds}`,
    source.read ? `Read: ${accessText(source.read)}.` : "",
    source.write ? `Write: ${accessText(source.write)}.` : "",
  ];
  return [
    parts.filter(Boolean).join(" "),
    ...(source.notes ?? []).map((note) => `  - ${note}`),
  ];
}

/**
 * The `## Memory` heading, the role's rules, and the index of every source the
 * agent has: the one place it is told what each memory holds and how to read
 * or write it. The sources' content sections follow it in the preamble.
 */
export function renderMemoryIndex(
  sources: readonly MemorySourceInfo[],
  role: AgentRole,
): string {
  return [
    "## Memory",
    "",
    "Your memory sources are listed below. Treat them as authoritative",
    "standing context and consult them before acting. A large source shows a",
    "table of contents instead of its full text: fetch the entries you need,",
    "by id, before relying on them.",
    ...roleRules(role),
    "",
    "### Index",
    "",
    ...sources.flatMap(sourceLines),
  ].join("\n");
}

/** `access` without the tools outside `granted`, or `undefined` if none remain. */
function grantedAccess(
  access: MemoryAccess | undefined,
  granted: ReadonlySet<string>,
): MemoryAccess | undefined {
  if (!access || "file" in access) return access;
  const tools = access.tools.filter((tool) => granted.has(tool));
  return tools.length ? { tools } : undefined;
}

/**
 * `sources` with every tool the agent wasn't granted removed, so the index
 * never advertises a tool missing from the spawn's `--tools` allowlist.
 */
export function onlyGrantedTools(
  sources: readonly MemorySourceInfo[],
  granted: ReadonlySet<string>,
): MemorySourceInfo[] {
  return sources.map((source) => ({
    ...source,
    read: grantedAccess(source.read, granted),
    write: grantedAccess(source.write, granted),
  }));
}
