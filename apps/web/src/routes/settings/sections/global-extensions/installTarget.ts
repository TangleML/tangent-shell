/** The item chosen in step 1, carried into the confirm step. */
export type InstallTarget =
  | {
      kind: "source";
      source: string;
      name: string;
      version?: string;
      installed: boolean;
    }
  | { kind: "file"; file: File };

export function parseTools(raw: string): string[] | undefined {
  const tools = raw
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}
