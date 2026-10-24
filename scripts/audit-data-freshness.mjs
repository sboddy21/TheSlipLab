import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCurrentDataset } from "../website/lib/data-freshness.mjs";

const root = fileURLToPath(new URL("../website/data/", import.meta.url));
const now = Date.now();
let health = null;
try { health = JSON.parse(await fs.readFile(path.join(root, "health_status.json"), "utf8")); }
catch { /* Missing health evidence makes legacy data unverifiable. */ }
async function audit(directory, prefix = "") {
  const rows = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = `${prefix}${entry.name}`;
    if (entry.isDirectory()) rows.push(...await audit(path.join(directory, entry.name), `${file}/`));
    else if (entry.name.endsWith(".json")) {
      try {
        const payload = JSON.parse(await fs.readFile(path.join(directory, entry.name), "utf8"));
        rows.push({ file, ...await verifyCurrentDataset(file, payload, { now, health, load: async dependency => JSON.parse(await fs.readFile(path.join(root, dependency), "utf8")) }) });
      } catch (error) { rows.push({ file, available: false, status: "unavailable", reasons: [error.message] }); }
    }
  }
  return rows;
}
const files = await audit(root);
const unavailable = files.filter(row => !row.available);
console.log(JSON.stringify({ checkedAt: new Date(now).toISOString(), checked: files.length, unavailable: unavailable.length, files }, null, 2));
if (unavailable.length) process.exitCode = 1;
