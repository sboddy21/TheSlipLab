import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "website", "data");

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
  } catch {
    return fallback;
  }
}

function write(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2));
}

function num(v, fallback = 0) {
  const n = Number(String(v ?? "").replace("%", "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function teamIdList() {
  const games = read("mlb_games_today.json", {});
  const rows = Array.isArray(games) ? games : games.games || games.dates?.[0]?.games || [];

  const teams = new Map();

  for (const g of rows) {
    const awayId = g.awayTeamId || g.teams?.away?.team?.id;
    const homeId = g.homeTeamId || g.teams?.home?.team?.id;
    const awayName = g.awayTeam || g.teams?.away?.team?.name;
    const homeName = g.homeTeam || g.teams?.home?.team?.name;

    if (awayId && awayName) teams.set(Number(awayId), awayName);
    if (homeId && homeName) teams.set(Number(homeId), homeName);
  }

  return [...teams.entries()].map(([id, name]) => ({ id, name }));
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function pitcherStats(playerId) {
  const season = new Date().getFullYear();
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=pitching&season=${season}`;
  const data = await getJson(url);
  const stat = data?.stats?.[0]?.splits?.[0]?.stat || {};

  const ip = num(stat.inningsPitched);
  const hr = num(stat.homeRuns);
  const hits = num(stat.hits);
  const bb = num(stat.baseOnBalls);
  const so = num(stat.strikeOuts);
  const era = num(stat.era, null);
  const whip = num(stat.whip, null);

  const hr9 = ip > 0 ? hr * 9 / ip : 0;
  const h9 = ip > 0 ? hits * 9 / ip : 0;
  const bb9 = ip > 0 ? bb * 9 / ip : 0;
  const k9 = ip > 0 ? so * 9 / ip : 0;

  const risk = Math.max(0, Math.min(100,
    hr9 * 24 +
    h9 * 2.4 +
    bb9 * 2.8 +
    Math.max(0, 5.2 - k9) * 4 +
    (era ? Math.max(0, era - 3.70) * 7 : 0) +
    (whip ? Math.max(0, whip - 1.20) * 28 : 0)
  ));

  return {
    inningsPitched: stat.inningsPitched || "0.0",
    era,
    whip,
    homeRunsAllowed: hr,
    hitsAllowed: hits,
    walks: bb,
    strikeouts: so,
    hr9: Math.round(hr9 * 100) / 100,
    h9: Math.round(h9 * 100) / 100,
    bb9: Math.round(bb9 * 100) / 100,
    k9: Math.round(k9 * 100) / 100,
    hrRiskScore: Math.round(risk * 10) / 10
  };
}

function tag(risk) {
  if (risk >= 75) return "HR Leak";
  if (risk >= 60) return "Danger";
  if (risk >= 42) return "Watch";
  return "Stable";
}

async function teamRelievers(team) {
  const rosterUrl = `https://statsapi.mlb.com/api/v1/teams/${team.id}/roster?rosterType=active`;
  const roster = await getJson(rosterUrl);
  const players = roster.roster || [];

  const pitchers = players.filter(p => {
    const pos = String(p.position?.abbreviation || p.position?.name || "").toUpperCase();
    return pos === "P" || pos.includes("PITCHER");
  });

  const out = [];

  for (const p of pitchers) {
    try {
      const stats = await pitcherStats(p.person.id);

      const reliever = {
        team: team.name,
        teamId: team.id,
        playerId: p.person.id,
        pitcher: p.person.fullName,
        name: p.person.fullName,
        hand: p.person.pitchHand?.code || p.person.pitchHand?.description || "",
        position: p.position?.abbreviation || "P",
        ...stats
      };

      reliever.tag = tag(reliever.hrRiskScore);

      out.push(reliever);
    } catch {
      out.push({
        team: team.name,
        teamId: team.id,
        playerId: p.person.id,
        pitcher: p.person.fullName,
        name: p.person.fullName,
        hand: p.person.pitchHand?.code || p.person.pitchHand?.description || "",
        position: p.position?.abbreviation || "P",
        hrRiskScore: 0,
        tag: "Stats Pending"
      });
    }
  }

  return out
    .filter(p => num(p.inningsPitched) < 70 || p.position === "P")
    .sort((a, b) => num(b.hrRiskScore) - num(a.hrRiskScore))
    .slice(0, 8);
}

async function main() {
  const teams = teamIdList();

  if (!teams.length) {
    throw new Error("No teams found in mlb_games_today.json");
  }

  const all = [];

  for (const team of teams) {
    const relievers = await teamRelievers(team);
    all.push(...relievers);
  }

  const byTeam = {};
  for (const r of all) {
    if (!byTeam[r.team]) byTeam[r.team] = [];
    byTeam[r.team].push(r);
  }

  const output = {
    updatedAt: new Date().toISOString(),
    totalRelievers: all.length,
    byTeam,
    players: all
  };

  write("bullpen_relievers.json", output);

  console.log("BULLPEN RELIEVERS COMPLETE");
  console.log("Teams:", teams.length);
  console.log("Relievers:", all.length);
}

main().catch(err => {
  console.error("BULLPEN RELIEVERS FAILED");
  console.error(err);
  process.exit(1);
});
