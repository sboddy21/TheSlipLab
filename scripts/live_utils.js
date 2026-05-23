export function toArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.games)) return payload.games;
  if (Array.isArray(payload.alerts)) return payload.alerts;
  if (Array.isArray(payload.stacks)) return payload.stacks;
  if (Array.isArray(payload.players)) return payload.players;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.teams)) return payload.teams;
  return [];
}

export function norm(value = "") {
  return String(value)
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function gameKey(row = {}) {
  const home =
    row.homeTeam ||
    row.home_team ||
    row.home ||
    row.homeTeamName ||
    "";

  const away =
    row.awayTeam ||
    row.away_team ||
    row.away ||
    row.awayTeamName ||
    "";

  if (home && away) {
    return `${norm(away)} @ ${norm(home)}`;
  }

  return norm(row.game || row.matchup || "");
}

export function dedupeByGame(rows = [], scoreFields = []) {
  const map = new Map();

  for (const row of rows) {
    const key = gameKey(row);
    if (!key) continue;

    const current = map.get(key);

    if (!current) {
      map.set(key, row);
      continue;
    }

    const currentScore = scoreFields.reduce(
      (best, field) => Math.max(best, num(current[field])),
      0
    );

    const nextScore = scoreFields.reduce(
      (best, field) => Math.max(best, num(row[field])),
      0
    );

    if (nextScore >= currentScore) {
      map.set(key, row);
    }
  }

  return [...map.values()];
}
