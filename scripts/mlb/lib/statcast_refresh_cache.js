import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, ".cache", "mlb-statcast-refresh");

function cachePath({ slateDate, playerType, playerId }) {
  return path.join(CACHE_DIR, slateDate, `${playerType}-${playerId}.json`);
}

export function writeStatcastRefreshRows({ slateDate, season, playerType, playerId, rows }) {
  if (!slateDate || !playerId || !Array.isArray(rows)) return;
  const file = cachePath({ slateDate, playerType, playerId });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({
    schemaVersion: 1,
    slateDate,
    season,
    playerType,
    playerId: String(playerId),
    rows
  }));
  fs.renameSync(temporary, file);
}

export function readStatcastRefreshRows({ slateDate, season, playerType, playerId }) {
  const file = cachePath({ slateDate, playerType, playerId });
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      payload?.schemaVersion !== 1 ||
      payload?.slateDate !== slateDate ||
      Number(payload?.season) !== Number(season) ||
      payload?.playerType !== playerType ||
      String(payload?.playerId) !== String(playerId) ||
      !Array.isArray(payload?.rows)
    ) return null;
    return payload.rows;
  } catch {
    return null;
  }
}
