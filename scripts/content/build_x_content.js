import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  } catch {
    return fallback;
  }
}

function clean(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value).trim();
}

function topRows(rows, count = 5) {
  return [...rows]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, count);
}

function buildTopHrPost(rows) {
  const top = topRows(rows, 5);

  return [
    "THE SLIP LAB HR BOARD",
    "",
    "Top model bats right now:",
    "",
    ...top.map((row, i) =>
      `${i + 1}. ${clean(row.player)} | ${clean(row.team)} | Score ${clean(row.score)} | vs ${clean(row.opposingPitcher, "TBD")}`
    ),
    "",
    "Lineups matter. I do not blindly bet early.",
    "",
    "#MLB #GamblingX #TheSlipLab"
  ].join("\n");
}

function buildVulnerabilityPost(rows) {
  const map = new Map();

  rows.forEach(row => {
    const pitcher = clean(row.opposingPitcher, "Unknown Pitcher");

    if (!map.has(pitcher)) {
      map.set(pitcher, {
        pitcher,
        score: Number(row.score || 0),
        era: row.stats?.pitcher?.era || "--",
        bats: []
      });
    }

    const item = map.get(pitcher);
    item.score = Math.max(item.score, Number(row.score || 0));
    item.bats.push(row);
  });

  const top = [...map.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return [
    "TOP PITCHER VULNERABILITIES",
    "",
    ...top.map((item, i) => {
      const bats = item.bats
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, 3)
        .map(row => clean(row.player))
        .join(", ");

      return `${i + 1}. ${item.pitcher} | ERA ${item.era} | Attack bats: ${bats}`;
    }),
    "",
    "These are matchup pressure spots, not blind bets.",
    "",
    "#MLB #HomeRuns #TheSlipLab"
  ].join("\n");
}

function buildHardHitPost(rows) {
  const top = topRows(rows, 6);

  return [
    "HARD CONTACT WATCHLIST",
    "",
    ...top.map((row, i) => {
      const hitter = row.stats?.hitter || {};
      return `${i + 1}. ${clean(row.player)} | HR ${clean(hitter.hr, "--")} | SLG ${clean(hitter.slg, "--")} | OPS ${clean(hitter.ops, "--")}`;
    }),
    "",
    "Power profile plus matchup context. Waiting for lineups.",
    "",
    "#MLB #TheSlipLab"
  ].join("\n");
}

function buildMeatballPost(rows) {
  const top = topRows(rows, 5);

  return [
    "MEATBALL MATCHUPS",
    "",
    "Bats sitting in playable damage spots:",
    "",
    ...top.map((row, i) =>
      `${i + 1}. ${clean(row.player)} vs ${clean(row.opposingPitcher, "TBD")} | ${clean(row.note, "Power profile active")}`
    ),
    "",
    "I want confirmed lineups before turning reads into slips.",
    "",
    "#MLB #GamblingX #TheSlipLab"
  ].join("\n");
}

function buildRecapPost(games) {
  const finals = Array.isArray(games)
    ? games.filter(game => /final/i.test(clean(game.status || game.gameStatus || game.detailedState || "")))
    : [];

  if (!finals.length) {
    return [
      "MLB RECAP WATCH",
      "",
      "Final game data is still building.",
      "",
      "Once results settle, this feed will power daily recap posts.",
      "",
      "#MLB #TheSlipLab"
    ].join("\n");
  }

  return [
    "MLB FINAL SCORE RECAP",
    "",
    ...finals.slice(0, 6).map(game =>
      `${clean(game.matchup, "MLB Game")} | ${clean(game.awayScore, "--")} to ${clean(game.homeScore, "--")}`
    ),
    "",
    "HR result tracking layer comes next.",
    "",
    "#MLB #TheSlipLab"
  ].join("\n");
}

function main() {
  fs.mkdirSync(path.join(ROOT, "website/data/content"), { recursive: true });
  fs.mkdirSync(path.join(ROOT, "exports/content"), { recursive: true });

  const rows = readJson("website/data/mlb_home_runs.json", []);
  const gamesData = readJson("website/data/mlb_games.json", {});
  const games = Array.isArray(gamesData) ? gamesData : gamesData.games || [];

  const posts = [
    {
      type: "top_hr_board",
      title: "Top HR Board",
      post: buildTopHrPost(rows)
    },
    {
      type: "pitcher_vulnerabilities",
      title: "Pitcher Vulnerabilities",
      post: buildVulnerabilityPost(rows)
    },
    {
      type: "hard_contact_watchlist",
      title: "Hard Contact Watchlist",
      post: buildHardHitPost(rows)
    },
    {
      type: "meatball_matchups",
      title: "Meatball Matchups",
      post: buildMeatballPost(rows)
    },
    {
      type: "game_recap",
      title: "Game Recap",
      post: buildRecapPost(games)
    }
  ].map(item => ({
    ...item,
    characters: item.post.length,
    generatedAt: new Date().toISOString()
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "The Slip Lab live JSON boards",
    posts
  };

  fs.writeFileSync(
    path.join(ROOT, "website/data/content/x_posts.json"),
    JSON.stringify(payload, null, 2)
  );

  fs.writeFileSync(
    path.join(ROOT, "exports/content/x_posts.txt"),
    posts.map(item => `=== ${item.title} ===\n${item.post}\n`).join("\n")
  );

  console.log("X CONTENT ENGINE COMPLETE");
  console.log(`Posts: ${posts.length}`);
  console.log("Saved: website/data/content/x_posts.json");
  console.log("Saved: exports/content/x_posts.txt");
}

main();
