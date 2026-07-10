import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL_BUILDER = path.resolve(HERE, "build_x_daily_queue_v2.js");

console.warn("Deprecated entrypoint: forwarding to scripts/content/build_x_daily_queue_v2.js");

const result = spawnSync(process.execPath, [CANONICAL_BUILDER], {
  stdio: "inherit",
  env: process.env
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
