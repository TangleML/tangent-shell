import { execFileSync } from "node:child_process";

type Version = [major: number, minor: number, patch: number];

/** The first Pi whose run lifecycle (`agent_settled`, prompt dispositions) the manager relies on. */
export const MIN_PI_VERSION: Version = [1, 6, 0];

function parseVersion(text: string): Version | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAtLeast(version: Version, min: Version): boolean {
  for (let i = 0; i < min.length; i++) {
    if (version[i] !== min[i]) return version[i] > min[i];
  }
  return true;
}

function readPiVersion(bin: string): string {
  return execFileSync(bin, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
  });
}

/**
 * Throws unless `bin` is a Pi the manager can drive. An older one never emits
 * `agent_settled`, so its Runs would stay open and its agents busy forever.
 */
export function assertPiVersion(
  bin: string,
  readVersion: (bin: string) => string = readPiVersion,
): void {
  const required = MIN_PI_VERSION.join(".");
  let output: string;
  try {
    output = readVersion(bin);
  } catch (error) {
    throw new Error(
      `Could not run "${bin} --version". Install Pi ${required} or later, or set PI_BIN.`,
      { cause: error },
    );
  }
  const version = parseVersion(output);
  if (!version || !isAtLeast(version, MIN_PI_VERSION)) {
    throw new Error(
      `"${bin}" reports version "${output.trim()}", but Tangent needs Pi ${required} or later.`,
    );
  }
}
