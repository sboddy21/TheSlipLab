import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "website/data/nba_defender_engine.json");

function seasonYear() {
  const now = new Date();
  const year = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric"
  }).format(now));

  const month = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "numeric"
  }).format(now));

  const start = month >= 10 ? year : year - 1;
  const end = String(start + 1).slice(-2);

  return `${start}-${end}`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round1(v) {
  return Math.round(num(v) * 10) / 10;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Origin": "https://www.nba.com",
      "Referer": "https://www.nba.com/",
      "x-nba-stats-origin": "stats",
      "x-nba-stats-token": "true"
    }
  });

  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  return await res.json();
}

function tier(row) {
  const diff = num(row.pctPlusMinus);
  const fga = num(row.defendedFGA);

  if (fga >= 10 && diff <= -5) return "Elite Defender";
  if (fga >= 8 && diff <= -3) return "Strong Defender";
  if (diff <= -1.5) return "Positive Defender";
  if (diff >= 3) return "Attackable Defender";
  return "Neutral Defender";
}

function parseRows(data) {
  const set = data?.resultSets?.[0] || data?.resultSet || {};
  const headers = Array.isArray(set.headers) ? set.headers : [];
  const rows = Array.isArray(set.rowSet) ? set.rowSet : [];
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  return rows.map(row => {
    const out = {
      playerId: String(row[idx.CLOSE_DEF_PERSON_ID] || ""),
      player: row[idx.PLAYER_NAME] || "",
      teamId: String(row[idx.PLAYER_LAST_TEAM_ID] || ""),
      team: row[idx.PLAYER_LAST_TEAM_ABBREVIATION] || "",
      position: row[idx.PLAYER_POSITION] || "",
      age: num(row[idx.AGE]),
      games: num(row[idx.GP]),
      defendedFrequency: round1(num(row[idx.FREQ]) * 100),
      defendedFGM: round1(row[idx.D_FGM]),
      defendedFGA: round1(row[idx.D_FGA]),
      defendedFGPct: round1(num(row[idx.D_FG_PCT]) * 100),
      normalFGPct: round1(num(row[idx.NORMAL_FG_PCT]) * 100),
      pctPlusMinus: round1(num(row[idx.PCT_PLUSMINUS]) * 100)
    };

    out.defenderTier = tier(out);
    return out;
  });
}

async function main() {
  const season = seasonYear();

  const params = new URLSearchParams({
    DefenseCategory: "Overall",
    LeagueID: "00",
    PerMode: "PerGame",
    Season: season,
    SeasonType: "Regular Season"
  });

  const url = `https://stats.nba.com/stats/leaguedashptdefend?${params.toString()}`;
  const data = await fetchJson(url);

  const defenders = parseRows(data)
    .filter(d => d.player && d.team)
    .filter(d => num(d.defendedFGA) >= 6)
    .sort((a, b) =>
      num(a.pctPlusMinus) - num(b.pctPlusMinus) ||
      num(b.defendedFGA) - num(a.defendedFGA) ||
      String(a.player).localeCompare(String(b.player))
    );

  const byTeam = {};
  for (const d of defenders) {
    if (!byTeam[d.team]) byTeam[d.team] = [];
    byTeam[d.team].push(d);
  }

  for (const team of Object.keys(byTeam)) {
    byTeam[team] = byTeam[team]
      .sort((a, b) =>
        num(a.pctPlusMinus) - num(b.pctPlusMinus) ||
        num(b.defendedFGA) - num(a.defendedFGA)
      )
      .slice(0, 8);
  }

  const out = {
    sport: "NBA",
    version: "1.0",
    source: "NBA stats leaguedashptdefend overall",
    fetchedAt: new Date().toISOString(),
    season,
    defenderCount: defenders.length,
    minimumDefendedFGA: 6,
    teamCount: Object.keys(byTeam).length,
    modelNotes: [
      "Defender Engine 1.0 uses NBA tracking defended field goal data.",
      "Leaderboard requires at least 6 defended field goal attempts per game to reduce low-volume noise.",
      "Negative pctPlusMinus means the defender holds shooters below their normal field goal percentage.",
      "This is player defender data, not team position defense.",
      "No odds or betting lines are used."
    ],
    defenders,
    byTeam
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA DEFENDER ENGINE COMPLETE");
  console.log("Season:", season);
  console.log("Defenders:", defenders.length);
  console.log("Teams:", Object.keys(byTeam).length);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA DEFENDER ENGINE FAILED");
  console.error(err);
  process.exit(1);
});
