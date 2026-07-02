import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // No .env file present — fine, values may come from the real environment.
}
