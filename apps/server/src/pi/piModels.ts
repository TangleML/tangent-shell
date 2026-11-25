import { spawn } from "node:child_process";
import os from "node:os";
import readline from "node:readline";

import {
  AVAILABLE_MODELS,
  type ModelOption,
} from "@tangent/shared/contracts.ts";
import { z } from "zod";

import { PI_BIN } from "../config.ts";
import { catalogSpawnEnv, withoutCatalogCredentials } from "../modelCatalog.ts";
import { PROXY_PROVIDER_EXTENSION } from "./utils.ts";

const REQUEST_ID = "list-models";
const TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 10 * 60_000;

const responseSchema = z.object({
  type: z.literal("response"),
  id: z.literal(REQUEST_ID),
  success: z.boolean(),
  error: z.string().optional(),
  data: z
    .object({
      models: z.array(
        z.object({
          id: z.string().min(1),
          name: z.string().optional(),
          provider: z.string().min(1),
        }),
      ),
    })
    .optional(),
});

/**
 * Parses one line of Pi RPC stdout. Returns `undefined` for lines that are not
 * the `get_available_models` response; throws if Pi reported a failure.
 */
export function parseModelsResponse(line: string): ModelOption[] | undefined {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = responseSchema.safeParse(message);
  if (!parsed.success) return undefined;
  const { success, error, data } = parsed.data;
  if (!success || !data)
    throw new Error(error ?? "Pi failed to list available models");
  return data.models.map((model) => ({
    id: `${model.provider}/${model.id}`,
    label: model.name || model.id,
    provider: model.provider,
  }));
}

/** Asks a short-lived Pi RPC process for the models it can resolve. */
function queryPiModels(): Promise<ModelOption[]> {
  return new Promise((resolve, reject) => {
    // Same provider registration and env as agent spawns, so the list matches
    // what `--model` can actually resolve.
    const child = spawn(
      PI_BIN,
      [
        "--mode",
        "rpc",
        "--no-session",
        "--no-skills",
        "--no-tools",
        "--extension",
        PROXY_PROVIDER_EXTENSION,
      ],
      {
        cwd: os.tmpdir(),
        env: {
          ...withoutCatalogCredentials(process.env),
          ...catalogSpawnEnv(),
        },
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    const lines = readline.createInterface({ input: child.stdout });
    let settled = false;
    const finish = (result: ModelOption[] | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.kill();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const timer = setTimeout(
      () => finish(new Error("Timed out waiting for Pi to list models")),
      TIMEOUT_MS,
    );

    child.once("error", finish);
    child.stdin.once("error", finish);
    child.once("exit", (code) =>
      finish(new Error(`Pi exited (code ${code}) before listing models`)),
    );
    lines.on("line", (line) => {
      try {
        const models = parseModelsResponse(line);
        if (models) finish(models);
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });
    child.stdin.write(
      `${JSON.stringify({ id: REQUEST_ID, type: "get_available_models" })}\n`,
    );
  });
}

// Keep in sync with registerDirectProviders in extensions/proxyProvider.ts.
const DIRECT_PROVIDER_KEYS: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  groq: ["GROQ_API_KEY"],
  xai: ["XAI_API_KEY"],
};

/**
 * Without a gateway, keeps only models whose provider has its API key set: Pi
 * may also list providers (e.g. from `~/.pi`) that agents can't call.
 */
export function withConfiguredProviders(
  models: ModelOption[],
  env: NodeJS.ProcessEnv,
): ModelOption[] {
  if (env.PI_PROXY_URL && env.PI_PROXY_API_KEY) return models;
  return models.filter((model) =>
    DIRECT_PROVIDER_KEYS[model.provider]?.some((key) => env[key]),
  );
}

let cache: { models: Promise<ModelOption[]>; at: number } | undefined;

/**
 * Models offered in the per-agent picker, as reported by Pi. Falls back to the
 * static {@link AVAILABLE_MODELS} when Pi can't be queried or lists nothing.
 */
export async function listPiModels(): Promise<ModelOption[]> {
  if (!cache || Date.now() - cache.at > CACHE_TTL_MS) {
    const models = queryPiModels();
    cache = { models, at: Date.now() };
    models.catch(() => {
      if (cache?.models === models) cache = undefined;
    });
  }
  try {
    const models = withConfiguredProviders(await cache.models, process.env);
    if (models.length > 0) return models;
    console.warn("[pi] no models available; using the built-in model list");
  } catch (err) {
    console.warn("[pi] failed to list models; using the built-in list:", err);
  }
  return withConfiguredProviders(AVAILABLE_MODELS, process.env);
}
