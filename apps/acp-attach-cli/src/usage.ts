import { knownAgents } from "./config.ts";

/** The command-line help, printed for `--help` or a parse error. */
export function usage(): string {
  return [
    "tangent-acp-attach — join a local coding agent into a Tangent session over ACP.",
    "",
    "Usage:",
    "  tangent-acp-attach --url <shell> --session <id|url> --agent <name> --token <token>",
    "",
    "Talk to the attached agent from the launcher (same machine):",
    "  tangent-acp-attach peer send --session <id> --text <message>",
    "  tangent-acp-attach peer wait --session <id> [--timeout <seconds>]",
    "",
    "Options:",
    "  --url      Tangent Shell URL (or TANGENT_SHELL_URL).",
    "  --session  Session id, or a pasted session URL (or TANGENT_SESSION_ID).",
    "  --token    Session-scoped attach token (or TANGENT_ATTACH_TOKEN).",
    "  --email    Identity to mint/refresh a token with, if no --token (or TANGENT_EMAIL).",
    "  --agent    Coding agent to run (or TANGENT_ACP_AGENT). Default: claude.",
    "  --cwd      Folder the agent works in (or TANGENT_CWD). Default: current.",
    '  --name     Roster display name. Default: "<agent> (attached)".',
    "  -h, --help Show this help.",
    "",
    `Built-in agents: ${knownAgents().join(", ")}.`,
    "Any other --agent value is run as a raw ACP command.",
  ].join("\n");
}
