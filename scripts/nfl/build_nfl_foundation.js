import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "website", "data");

function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function writeJson(filename, payload) {
  const file = path.join(DATA_DIR, filename);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Built website/data/${filename}`);
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), "utf8"));
}

const now = new Date();
const date = isoDate(now);
const phaseDefinitions = [
  {
    id: "foundation", label: "Data Foundation", window: "August 7 – August 13", start: "2026-08-07", end: "2026-08-13",
    objective: "Stabilize schedule, roster, identity, availability, and source-health contracts before modeling usage.",
    tasks: ["Load 2026 regular-season schedule", "Normalize all 32 teams", "Build QB/RB/WR/TE player pool", "Validate canonical provider IDs"]
  },
  {
    id: "camp", label: "Training Camp Inputs", window: "August 14 – August 20", start: "2026-08-14", end: "2026-08-20",
    objective: "Join depth, injury, historical usage, and finalized preseason opportunity while preserving explicit source gaps.",
    tasks: ["Normalize depth charts", "Track roster-reported injuries", "Process finalized preseason opportunity", "Audit player identity and ownership", "Keep unavailable snaps and routes explicitly gated"]
  },
  {
    id: "usage_model", label: "Usage Engine", window: "August 21 – August 27", start: "2026-08-21", end: "2026-08-27",
    objective: "Add matchup, environment, and market inputs around the validated role and opportunity foundation.",
    tasks: ["Expected usage framework", "Target and carry opportunity context", "Red-zone opportunity context", "Pace and defensive matchup context", "Weather and availability contracts"]
  },
  {
    id: "dress_rehearsal", label: "Dress Rehearsal", window: "August 28 – September 8", start: "2026-08-28", end: "2026-09-08",
    objective: "Run shadow projections, automated updates, result grading, and the final Week 1 integrity sweep.",
    tasks: ["Automated updates", "Shadow projections", "Results framework", "Market freshness tests", "Bug sweep before Week 1"]
  }
];
const phaseStatus = phase => date < phase.start ? "queued" : date > phase.end ? "complete" : "active";
const phases = phaseDefinitions.map(({ start, end, objective, ...phase }) => ({ ...phase, status: phaseStatus({ start, end }) }));
const activePhaseDefinition = phaseDefinitions.find(phase => phaseStatus(phase) === "active")
  || [...phaseDefinitions].reverse().find(phase => date >= phase.start)
  || phaseDefinitions[0];
const phaseHeadline = {
  foundation: "NFL Lab data foundation is underway.",
  camp: "NFL Lab training-camp inputs are underway.",
  usage_model: "NFL Lab usage engine is underway.",
  dress_rehearsal: "NFL Lab dress rehearsal is underway."
}[activePhaseDefinition.id];

const markets = {
  sport: "NFL",
  version: "0.1.0",
  status: activePhaseDefinition.id,
  updatedAt: now.toISOString(),
  launchMarkets: [
    {
      id: "anytime_td",
      label: "Anytime TD",
      launchPriority: 1,
      supportedPositions: ["RB", "WR", "TE", "QB"],
      coreInputs: ["redZoneRole", "rushShare", "targetShare", "teamScoringContext", "defenseTdAllowed"],
      status: "private_shadow"
    },
    {
      id: "receiving_yards",
      label: "Receiving Yards",
      launchPriority: 2,
      supportedPositions: ["WR", "TE", "RB"],
      coreInputs: ["routeShare", "targetShare", "airYardsShare", "defenseCoverage"],
      status: "private_shadow"
    },
    {
      id: "rushing_yards",
      label: "Rushing Yards",
      launchPriority: 3,
      supportedPositions: ["RB", "QB"],
      coreInputs: ["carryShare", "snapShare", "offensiveLineContext", "gameScript"],
      status: "inputs_gated"
    },
    {
      id: "passing_yards",
      label: "Passing Yards",
      launchPriority: 4,
      supportedPositions: ["QB"],
      coreInputs: ["dropbackRate", "passRateOverExpected", "opponentPressure", "pace"],
      status: "inputs_gated"
    }
  ],
  deferredMarkets: [
    {
      id: "receptions",
      label: "Receptions",
      launchPriority: 5,
      supportedPositions: ["WR", "TE", "RB"],
      coreInputs: ["targetShare", "routeShare", "aDot", "coverageShell"],
      reason: "Add after route and target-share inputs are stable."
    },
    {
      id: "passing_tds",
      label: "Passing TDs",
      reason: "Add after usage, lines, and red-zone context are stable."
    },
    {
      id: "interceptions",
      label: "Interceptions",
      reason: "Higher-noise market; better after QB pressure/coverage pipeline is reliable."
    }
  ]
};

const foundation = {
  sport: "NFL",
  version: "0.1.0",
  status: activePhaseDefinition.id,
  season: "2026",
  date,
  updatedAt: now.toISOString(),
  headline: phaseHeadline,
  summary:
    "Schedule, identity, usage, matchup, practice-report, weather, results, and private TD/receiving shadow contracts are wired. Recommendations remain gated until every player-data input passes.",
  currentPhase: {
    id: activePhaseDefinition.id,
    label: activePhaseDefinition.label,
    window: activePhaseDefinition.window,
    objective: activePhaseDefinition.objective
  },
  phases,
  dataContracts: [
    {
      file: "nfl_schedule.json",
      purpose: "Canonical 2026 regular-season schedule with provider game/team IDs, kickoff, venue, and broadcast context."
    },
    {
      file: "nfl_games_today.json",
      purpose: "Daily NFL slate shell with kickoff, teams, venue, weather, and game environment."
    },
    {
      file: "nfl_teams.json",
      purpose: "Canonical 32-team identity table used to join schedule, roster, usage, and market sources."
    },
    {
      file: "nfl_player_pool.json",
      purpose: "Eligible players by market with team, opponent, position, depth role, and availability."
    },
    {
      file: "nfl_depth_charts.json",
      purpose: "Latest team-by-team QB/RB/WR/TE depth slots, ranks, starters, and canonical player-ID joins."
    },
    {
      file: "nfl_injuries.json",
      purpose: "Roster-reported preseason injuries with explicit partial coverage until weekly practice reports begin."
    },
    {
      file: "nfl_usage_baselines.json",
      purpose: "Three-season targets, carries, passing, yardage, touchdown, and red-zone opportunity baselines for current players."
    },
    {
      file: "nfl_role_engine.json",
      purpose: "Availability-adjusted 2026 role certainty using current depth rank, historical opportunity, and team continuity."
    },
    {
      file: "nfl_matchup_context.json",
      purpose: "Verified weekly player-to-game assignments plus historical team scoring, pace, and defense-versus-position touchdown context."
    },
    {
      file: "nfl_td_decision_center.json",
      purpose: "Private Anytime TD shadow rankings built from verified goal-line, red-zone, touchdown, role, and recent-opportunity inputs."
    },
    { file: "nfl_practice_reports.json", purpose: "Official weekly availability and regular-season role gates that fail closed before reports begin." },
    { file: "nfl_weather.json", purpose: "Indoor verification and kickoff-hour forecasts with horizon and freshness rejection." },
    { file: "nfl_receiving_yards_board.json", purpose: "Private receiving-yards shadow signals; routes, confirmed roles, matchup, and weather remain required." },
    { file: "nfl_results_tracking.json", purpose: "Pre-kickoff snapshot and postgame grading contract with anti-leakage rules." },
    { file: "nfl_launch_audit.json", purpose: "Final identity, ownership, inactive-player, weather, role, and manual-navigation launch gate." },
    {
      file: "nfl_data_health.json",
      purpose: "Source-by-source availability and gating status; projections remain disabled until required inputs pass validation."
    },
    {
      file: "nfl_markets.json",
      purpose: "Supported and deferred prop markets with required model inputs."
    },
    {
      file: "nfl_decision_center.json",
      purpose: "Future ranked recommendations once role, market, and line data are live."
    }
  ],
  integrityRules: [
    "No fake player projections before data sources exist.",
    "Separate preseason usage signals from regular-season model confidence.",
    "Mark missing depth-chart, injury, role, route, or weather inputs as pending instead of inventing values.",
    "Every market must eventually connect to a result-tracking path."
  ],
  nextBuildSteps: [
    "Activate official weekly practice reports when providers begin publishing Week 1 designations.",
    "Require complete kickoff-hour weather coverage once every game enters the forecast horizon.",
    "Keep routes optional for TD candidates and mandatory for receiving-yards recommendations.",
    "Run TD and receiving-yards shadow boards through Week 1 and grade only pre-kickoff snapshots."
  ]
};

writeJson("nfl_foundation.json", foundation);
writeJson("nfl_markets.json", markets);
writeJson("nfl_decision_center.json", {
  sport: "NFL",
  version: "0.1.0",
  status: "projections_gated",
  season: "2026",
  date,
  updatedAt: now.toISOString(),
  marketCount: 0,
  playerCount: 0,
  disclaimer: "NFL recommendations are not live yet. The private TD shadow board remains gated until role, opponent, matchup, and weather inputs pass validation.",
  sections: []
});

const schedule = readJson("nfl_schedule.json");
const pool = readJson("nfl_player_pool.json");
const depth = readJson("nfl_depth_charts.json");
const injuries = readJson("nfl_injuries.json");
const usage = readJson("nfl_usage_baselines.json");
const preseason = readJson("nfl_preseason_usage.json");
const roles = readJson("nfl_role_engine.json");
const health = readJson("nfl_data_health.json");
writeJson("nfl_public_status.json", {
  sport: "NFL",
  schemaVersion: "1.0",
  season: 2026,
  generatedAt: now.toISOString(),
  status: health.status,
  counts: {
    games: schedule.gameCount,
    players: pool.playerCount,
    depthEntries: depth.entryCount,
    injuryReports: injuries.injuryCount,
    usageProfiles: usage.profileCount,
    completedPreseasonGames: preseason.processedGameCount,
    preseasonUsageProfiles: preseason.playerCount,
    roleEligible: roles.modelEligibleCount
  },
  preseasonUsage: {
    status: preseason.status,
    finalGameGate: preseason.finalGameGate,
    completedGames: preseason.processedGameCount,
    playerProfiles: preseason.playerCount,
    unavailableFields: preseason.coverage.unavailable
  },
  weekOneGames: schedule.games.filter(game => game.week === 1).map(game => ({
    gameId: game.gameId,
    kickoffUTC: game.kickoffUTC,
    venue: game.venue,
    broadcasts: game.broadcasts,
    homeTeam: { abbreviation: game.homeTeam.abbreviation },
    awayTeam: { abbreviation: game.awayTeam.abbreviation }
  })),
  sources: Object.fromEntries(Object.entries(health.sources || {}).map(([key, value]) => [key, { status: value.status }]))
});
