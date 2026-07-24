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

const now = new Date();
const date = isoDate(now);

const markets = {
  sport: "NFL",
  version: "0.1.0",
  status: "foundation",
  updatedAt: now.toISOString(),
  launchMarkets: [
    {
      id: "anytime_td",
      label: "Anytime TD",
      launchPriority: 1,
      supportedPositions: ["RB", "WR", "TE", "QB"],
      coreInputs: ["redZoneRole", "rushShare", "targetShare", "teamTotal", "defenseTdAllowed", "sportsbookLine"],
      status: "planned"
    },
    {
      id: "receiving_yards",
      label: "Receiving Yards",
      launchPriority: 2,
      supportedPositions: ["WR", "TE", "RB"],
      coreInputs: ["routeShare", "targetShare", "airYardsShare", "defenseCoverage", "sportsbookLine"],
      status: "planned"
    },
    {
      id: "rushing_yards",
      label: "Rushing Yards",
      launchPriority: 3,
      supportedPositions: ["RB", "QB"],
      coreInputs: ["carryShare", "snapShare", "offensiveLineContext", "gameScript", "sportsbookLine"],
      status: "planned"
    },
    {
      id: "passing_yards",
      label: "Passing Yards",
      launchPriority: 4,
      supportedPositions: ["QB"],
      coreInputs: ["dropbackRate", "passRateOverExpected", "opponentPressure", "pace", "sportsbookLine"],
      status: "planned"
    },
    {
      id: "receptions",
      label: "Receptions",
      launchPriority: 5,
      supportedPositions: ["WR", "TE", "RB"],
      coreInputs: ["targetShare", "routeShare", "aDot", "coverageShell", "sportsbookLine"],
      status: "planned"
    }
  ],
  deferredMarkets: [
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
  status: "foundation",
  season: "2026",
  date,
  updatedAt: now.toISOString(),
  headline: "NFL Lab foundation is underway.",
  summary:
    "Phase one establishes the data contracts, market priorities, and page shell before live projections are released.",
  currentPhase: {
    id: "foundation",
    label: "Foundation",
    window: "July 24 – July 31",
    objective: "Create the NFL data structure, supported markets, and launch surface without publishing fake predictions."
  },
  phases: [
    {
      id: "foundation",
      label: "Foundation",
      window: "July 24 – July 31",
      status: "active",
      tasks: [
        "Define launch markets",
        "Create starter JSON contracts",
        "Build NFL hub page",
        "Prepare refresh script shape"
      ]
    },
    {
      id: "camp",
      label: "Training Camp Inputs",
      window: "Early August",
      status: "queued",
      tasks: [
        "Depth charts",
        "Injury reports",
        "Position battles",
        "Beat-writer role notes",
        "Preseason snap counts"
      ]
    },
    {
      id: "preseason_model",
      label: "Preseason Model Shape",
      window: "Mid/Late August",
      status: "queued",
      tasks: [
        "Expected usage",
        "Target share",
        "Red-zone opportunities",
        "Pace of play",
        "Defensive matchup context",
        "Weather and sportsbook lines"
      ]
    },
    {
      id: "dress_rehearsal",
      label: "Dress Rehearsal",
      window: "Labor Day Week",
      status: "queued",
      tasks: [
        "Automated updates",
        "Test picks",
        "Results framework",
        "Bug sweep before Week 1"
      ]
    }
  ],
  dataContracts: [
    {
      file: "nfl_games_today.json",
      purpose: "Daily NFL slate shell with kickoff, teams, venue, weather, and game environment."
    },
    {
      file: "nfl_player_pool.json",
      purpose: "Eligible players by market with team, opponent, position, depth role, and availability."
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
    "Mark missing depth-chart, injury, line, or weather inputs as pending instead of inventing values.",
    "Every market must eventually connect to a result-tracking path."
  ],
  nextBuildSteps: [
    "Add nfl_games_today.json from the NFL schedule source.",
    "Add nfl_player_pool.json with teams, positions, roles, and launch-market eligibility.",
    "Create the first role engine for RB/WR/TE/QB usage.",
    "Add injury/depth-chart placeholders before training camp data arrives."
  ]
};

writeJson("nfl_foundation.json", foundation);
writeJson("nfl_markets.json", markets);
writeJson("nfl_games_today.json", {
  sport: "NFL",
  version: "0.1.0",
  status: "foundation",
  season: "2026",
  date,
  updatedAt: now.toISOString(),
  gameCount: 0,
  availability: "preseason_build",
  games: []
});
writeJson("nfl_player_pool.json", {
  sport: "NFL",
  version: "0.1.0",
  status: "foundation",
  season: "2026",
  date,
  updatedAt: now.toISOString(),
  playerCount: 0,
  availability: "preseason_build",
  players: []
});
writeJson("nfl_decision_center.json", {
  sport: "NFL",
  version: "0.1.0",
  status: "foundation",
  season: "2026",
  date,
  updatedAt: now.toISOString(),
  marketCount: markets.launchMarkets.length,
  playerCount: 0,
  disclaimer: "NFL recommendations are not live yet. This file is a foundation contract for the upcoming model.",
  sections: []
});
