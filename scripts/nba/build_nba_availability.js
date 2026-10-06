import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const POOL_FILE = path.join(ROOT, "website/data/nba_player_pool.json");
const OUT = path.join(ROOT, "website/data/nba_availability.json");
const INJURY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries";

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function normalizeName(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status.includes("out")) return "OUT";
  if (status.includes("doubt")) return "DOUBTFUL";
  if (status.includes("question")) return "QUESTIONABLE";
  if (status.includes("probable")) return "PROBABLE";
  if (status.includes("day-to-day") || status.includes("day to day")) return "DAY_TO_DAY";
  return status ? "REPORTED" : "UNKNOWN";
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Fetch failed ${response.status} ${url}`);
  return response.json();
}

function injuryRows(payload) {
  return (Array.isArray(payload?.injuries) ? payload.injuries : []).flatMap(team =>
    (Array.isArray(team?.injuries) ? team.injuries : []).map(injury => ({
      espnId: String(injury?.athlete?.id || ""),
      player: injury?.athlete?.displayName || "",
      playerKey: normalizeName(injury?.athlete?.displayName),
      team: team?.displayName || "",
      status: normalizeStatus(injury?.status),
      rawStatus: injury?.status || "Reported",
      type: injury?.type?.description || injury?.type?.name || "",
      shortComment: injury?.shortComment || "",
      detail: injury?.longComment || injury?.details?.detail || "",
      reportedAt: injury?.date || payload?.timestamp || ""
    }))
  );
}

async function main() {
  const pool = readJSON(POOL_FILE, { players: [], date: "" });
  const players = Array.isArray(pool.players) ? pool.players : [];
  const payload = await fetchJson(INJURY_URL);
  const injuries = injuryRows(payload);
  const injuryByName = new Map(injuries.map(row => [row.playerKey, row]));
  const feedTimestamp = payload?.timestamp || "";
  const ageHours = (Date.now() - Date.parse(feedTimestamp)) / 36e5;
  const feedCurrent = Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= 24;

  const rows = players.map(player => {
    const injury = injuryByName.get(normalizeName(player.player)) || null;
    const liveStatus = String(player.statusSource || "").includes("live box score");
    const liveActive = liveStatus && String(player.status).toUpperCase() === "ACTIVE";
    const availabilityStatus = liveActive ? "CONFIRMED_ACTIVE" : injury?.status || "UNKNOWN";
    const unavailable = ["OUT", "DOUBTFUL"].includes(availabilityStatus);
    const starterKnown = Boolean(player.starterKnown);
    const publicationEligible = feedCurrent && availabilityStatus === "CONFIRMED_ACTIVE" && starterKnown;
    return {
      playerId: player.playerId,
      player: player.player,
      team: player.teamAbbr,
      gameId: player.gameId,
      availabilityStatus,
      availabilityKnown: availabilityStatus !== "UNKNOWN",
      unavailable,
      injury,
      starter: Boolean(player.starter),
      starterKnown,
      starterSource: player.starterSource || "Unknown",
      publicationEligible,
      publicationStatus: publicationEligible ? "eligible" : unavailable ? "withheld_unavailable" : "context_only_unconfirmed_role"
    };
  });

  const out = {
    sport: "NBA",
    version: "1.0",
    source: "ESPN NBA league injury designations plus NBA game lineup state",
    sourceUrl: INJURY_URL,
    generatedAt: new Date().toISOString(),
    date: pool.date || "",
    feedTimestamp,
    feedCurrent,
    freshnessPolicy: {
      maximumAgeHours: 24,
      missingReportMeaning: "No injury report was matched; this is not a confirmed healthy designation."
    },
    playerCount: rows.length,
    reportedInjuryCount: injuries.length,
    matchedInjuryCount: rows.filter(row => row.injury).length,
    confirmedActiveCount: rows.filter(row => row.availabilityStatus === "CONFIRMED_ACTIVE").length,
    unknownCount: rows.filter(row => row.availabilityStatus === "UNKNOWN").length,
    publicationEligibleCount: rows.filter(row => row.publicationEligible).length,
    unmatchedInjuries: injuries.filter(injury => !rows.some(row => normalizeName(row.player) === injury.playerKey)),
    players: rows
  };

  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log("NBA AVAILABILITY COMPLETE");
  console.log("Players:", rows.length);
  console.log("Matched injuries:", out.matchedInjuryCount);
  console.log("Unknown availability:", out.unknownCount);
  console.log("Publication eligible:", out.publicationEligibleCount);
  console.log("Saved:", OUT);
}

main().catch(error => {
  console.error("NBA AVAILABILITY FAILED");
  console.error(error);
  process.exit(1);
});
