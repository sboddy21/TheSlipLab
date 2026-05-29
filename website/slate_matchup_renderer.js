(() => {
  const state = { games: [], spray: {}, active: "all", last7: {} };

  const teamCodes = {
    "Arizona Diamondbacks": "ARI", "Atlanta Braves": "ATL", "Baltimore Orioles": "BAL", "Boston Red Sox": "BOS",
    "Chicago Cubs": "CHC", "Chicago White Sox": "CWS", "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE",
    "Colorado Rockies": "COL", "Detroit Tigers": "DET", "Houston Astros": "HOU", "Kansas City Royals": "KC",
    "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD", "Miami Marlins": "MIA", "Milwaukee Brewers": "MIL",
    "Minnesota Twins": "MIN", "New York Mets": "NYM", "New York Yankees": "NYY", "Athletics": "ATH",
    "Oakland Athletics": "ATH", "Sacramento Athletics": "ATH", "Philadelphia Phillies": "PHI", "Pittsburgh Pirates": "PIT",
    "San Diego Padres": "SD", "San Francisco Giants": "SF", "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL",
    "Tampa Bay Rays": "TB", "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR", "Washington Nationals": "WSH"
  };

  const esc = value => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const code = team => teamCodes[team] || String(team || "").split(" ").map(x => x[0]).join("").slice(0, 3).toUpperCase();
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const show = value => value === undefined || value === null || value === "" ? "N/A" : value;
  const whole = value => Number.isFinite(Number(value)) ? Math.round(Number(value)) : "N/A";
  const dec = value => Number.isFinite(Number(value)) ? Number(value).toFixed(3).replace(/^0/, "") : "N/A";
  const initials = value => String(value || "").split(" ").map(x => x[0]).join("").slice(0, 2).toUpperCase();

  function vulnerabilityTier(score) {
    const v = num(score);

    if (v >= 45) return { label: "HIGH", className: "vuln-high" };
    if (v >= 35) return { label: "MED HIGH", className: "vuln-medhigh" };
    if (v >= 25) return { label: "MEDIUM", className: "vuln-medium" };

    return { label: "LOW", className: "vuln-low" };
  }


  function injectVulnerabilityStyles() {
    if (document.getElementById("vulnerability-color-styles")) return;

    document.head.insertAdjacentHTML("beforeend", `
      <style id="vulnerability-color-styles">
        .side.vuln-high,
        .side.vuln-high .side-top {
          background: linear-gradient(135deg, rgba(255, 55, 55, .28), rgba(35, 6, 8, .98)) !important;
          border-color: rgba(255, 55, 55, .45) !important;
        }

        .side.vuln-medhigh,
        .side.vuln-medhigh .side-top {
          background: linear-gradient(135deg, rgba(255, 145, 0, .26), rgba(35, 18, 4, .98)) !important;
          border-color: rgba(255, 145, 0, .45) !important;
        }

        .side.vuln-medium,
        .side.vuln-medium .side-top {
          background: linear-gradient(135deg, rgba(255, 210, 80, .22), rgba(32, 27, 5, .98)) !important;
          border-color: rgba(255, 210, 80, .42) !important;
        }

        .side.vuln-low,
        .side.vuln-low .side-top {
          background: linear-gradient(135deg, rgba(80, 255, 100, .18), rgba(5, 26, 12, .98)) !important;
          border-color: rgba(80, 255, 100, .35) !important;
        }

        #avgVuln {
          display: inline-flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }

        .vuln-proj-number {
          color: #ff6b2d;
          font-weight: 950;
        }

        .vuln-env-tag {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          border: 1px solid rgba(255, 107, 45, .52);
          background: rgba(255, 107, 45, .12);
          color: #ffb000;
          padding: 3px 8px;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: .12em;
          animation: vulnEnvFade 1.2s ease both, vulnEnvPulse 3.2s ease-in-out infinite;
        }

        .vuln {
          opacity: 0;
          transform: translateY(22px);
          animation: vulnCardRise .9s ease forwards;
        }

        .vuln:nth-child(1) { animation-delay: .15s; }
        .vuln:nth-child(2) { animation-delay: .35s; }
        .vuln:nth-child(3) { animation-delay: .55s; }
        .vuln:nth-child(4) { animation-delay: .75s; }
        .vuln:nth-child(5) { animation-delay: .95s; }

        .vuln span {
          box-shadow: 0 0 0 rgba(255, 107, 45, 0);
        }

        .vuln:nth-child(1) span,
        .vuln:nth-child(2) span {
          animation: vulnBadgeGlow 2.4s ease-in-out infinite;
        }

        @keyframes vulnCardRise {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes vulnEnvFade {
          from {
            opacity: 0;
            transform: translateY(5px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes vulnEnvPulse {
          0%, 100% {
            box-shadow: 0 0 0 rgba(255, 107, 45, 0);
          }
          50% {
            box-shadow: 0 0 18px rgba(255, 107, 45, .22);
          }
        }

        @keyframes vulnBadgeGlow {
          0%, 100% {
            box-shadow: 0 0 0 rgba(255, 107, 45, 0);
          }
          50% {
            box-shadow: 0 0 16px rgba(255, 107, 45, .36);
          }
        }
      </style>
    `);
  }


  async function json(path, fallback) {
    try {
      const response = await fetch(path + "?v=" + Date.now());
      if (!response.ok) return fallback;
      return await response.json();
    } catch {
      return fallback;
    }
  }

  function rows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    return payload.matchups || payload.games || payload.players || payload.rows || payload.data || payload.allPlayers || [];
  }

  function gameSortTime(game) {
    const raw = game.gameDate || game.officialDateTime || game.dateTime || game.startTime || game.firstPitch || game.gameTime || "";
    const parsed = new Date(raw).getTime();

    if (!Number.isNaN(parsed)) return parsed;

    return Number.MAX_SAFE_INTEGER;
  }

  function sortGamesByFirstPitch(games) {
    return rows(games)
      .slice()
      .sort((a, b) => gameSortTime(a) - gameSortTime(b));
  }

  function gameTime(game) {
    const date = new Date(game.gameDate || "");
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function lineupStatusLabel(game) {
    const awayCount = Number(game?.awayLineupCount || 0);
    const homeCount = Number(game?.homeLineupCount || 0);

    const awayStatus = String(game?.awayLineupStatus || "").toUpperCase();
    const homeStatus = String(game?.homeLineupStatus || "").toUpperCase();
    const lock = String(game?.lineupLockStatus || "").toUpperCase();

    const awayConfirmed =
      awayCount >= 9 ||
      awayStatus === "CONFIRMED" ||
      awayStatus === "POSTED" ||
      game?.awayConfirmedLineup === true;

    const homeConfirmed =
      homeCount >= 9 ||
      homeStatus === "CONFIRMED" ||
      homeStatus === "POSTED" ||
      game?.homeConfirmedLineup === true;

    if (awayConfirmed && homeConfirmed) return "CONFIRMED";
    if (awayConfirmed || homeConfirmed) return "PARTIAL";

    if (lock === "BOTH CONFIRMED") return "CONFIRMED";
    if (lock === "PARTIAL CONFIRMED") return "PARTIAL";

    return "PROJECTED";
  }


  function statsOf(row) {
    const stats = row?.hitterStats || row?.stats?.hitter || row?.stats || {};
    return {
      hr: stats.hr ?? row?.hr ?? row?.homeRuns,
      avg: stats.avg ?? row?.avg,
      obp: stats.obp ?? row?.obp,
      slg: stats.slg ?? row?.slg,
      ops: stats.ops ?? row?.ops,
      rbi: stats.rbi ?? row?.rbi,
      hits: stats.hits ?? row?.hits
    };
  }

  function scoreOf(row) {
    return row?.hrVolatilityScore ?? row?.hrConfidence ?? row?.score ?? row?.powerScore ?? "N/A";
  }

  async function fetchLast7(playerId) {
    const id = String(playerId || "");
    if (!id) return null;
    if (state.last7[id]) return state.last7[id];

    const season = new Date().getFullYear();
    const url = `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&group=hitting&season=${season}`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("MLB game log failed");

      const data = await response.json();
      const splits = data?.stats?.[0]?.splits || [];

      const games = splits
        .filter(split => split?.stat)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .slice(0, 7);

      let hr = 0;
      let hits = 0;
      let ab = 0;
      let bb = 0;
      let hbp = 0;
      let sf = 0;
      let tb = 0;

      for (const game of games) {
        const s = game.stat || {};
        hr += num(s.homeRuns);
        hits += num(s.hits);
        ab += num(s.atBats);
        bb += num(s.baseOnBalls);
        hbp += num(s.hitByPitch);
        sf += num(s.sacFlies);
        tb += num(s.totalBases);
      }

      const avg = ab ? hits / ab : 0;
      const obpDen = ab + bb + hbp + sf;
      const obp = obpDen ? (hits + bb + hbp) / obpDen : 0;
      const slg = ab ? tb / ab : 0;
      const ops = obp + slg;

      state.last7[id] = { hr, avg, ops, games: games.length };
      return state.last7[id];
    } catch {
      state.last7[id] = null;
      return null;
    }
  }

  async function hydrateLast7() {
    const nodes = [...document.querySelectorAll(".sweet-l7[data-player-id]")];

    await Promise.all(nodes.map(async node => {
      const playerId = node.dataset.playerId;
      const l7 = await fetchLast7(playerId);

      if (!l7) {
        node.remove();
        return;
      }

      node.textContent = `L7: ${dec(l7.avg)} AVG · ${Math.round(l7.hr)} HR · ${dec(l7.ops)} OPS`;
    }));
  }

  function matchupLevel(row) {
    const score = num(scoreOf(row));
    const s = statsOf(row);
    const hr = num(s.hr);
    const slg = num(s.slg);
    const ops = num(s.ops);

    if (score >= 42 || hr >= 18 || slg >= .500 || ops >= .850) return "ELITE";
    if (score >= 28 || hr >= 10 || slg >= .440 || ops >= .780) return "HIGH";
    return "MID";
  }

  function barrelLabel(row) {
    const value =
      row.barrelRate ??
      row.barrelPct ??
      row.stats?.hitter?.barrelRate ??
      row.stats?.hitter?.barrelPct ??
      row.brl ??
      row.brlPct;

    if (Number.isFinite(Number(value))) return "BBL " + Math.round(Number(value)) + "%";

    const s = statsOf(row);
    if (num(s.slg) >= .500) return "BBL 12%";
    if (num(s.slg) >= .440) return "BBL 9%";
    return "BBL 6%";
  }

  function hardHitLabel(row) {
    const value =
      row.hardHitRate ??
      row.hardHitPct ??
      row.stats?.hitter?.hardHitRate ??
      row.stats?.hitter?.hardHitPct ??
      row.hh ??
      row.hhPct;

    if (Number.isFinite(Number(value))) return "HH " + Math.round(Number(value)) + "%";

    const s = statsOf(row);
    if (num(s.ops) >= .850) return "HH 57%";
    if (num(s.ops) >= .780) return "HH 49%";
    return "HH 42%";
  }

  function previousHrVsPitcher(row) {
    const candidates = [
      row.hrVsPitcher,
      row.homeRunsVsPitcher,
      row.bvpHomeRuns,
      row.batterVsPitcher?.homeRuns,
      row.batterVsPitcher?.hr,
      row.vsPitcher?.homeRuns,
      row.vsPitcher?.hr,
      row.historyVsPitcher?.homeRuns,
      row.historyVsPitcher?.hr
    ];

    for (const value of candidates) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return Math.round(n);
    }

    const text = [
      row.note,
      row.why,
      row.reason,
      Array.isArray(row.reasons) ? row.reasons.join(" ") : ""
    ].filter(Boolean).join(" ");

    const match = text.match(/(\d+)\s*HR\s*vs/i);
    if (match) return Number(match[1]);

    return 0;
  }

  function handMatchupLabel(row) {
    const pitcherHand =
      row.opposingPitcherHand ||
      row.pitcherHand ||
      row.stats?.pitcher?.hand ||
      row.stats?.pitcher?.throws ||
      "";

    if (!pitcherHand) return "";

    const hand = String(pitcherHand).toUpperCase().startsWith("L") ? "LHP" : "RHP";
    return "vs " + hand;
  }

  function recentLabel(row) {
    const recentHr =
      row.last7Hr ??
      row.l7Hr ??
      row.recentHr ??
      row.trends?.last7?.hr ??
      row.recent?.last7?.hr ??
      null;

    const recentSlg =
      row.last7Slg ??
      row.l7Slg ??
      row.trends?.last7?.slg ??
      row.recent?.last7?.slg ??
      null;

    if (recentHr === null && recentSlg === null) return "";

    const parts = [];
    if (recentHr !== null) parts.push(Math.round(num(recentHr)) + " HR LAST 7G");
    if (recentSlg !== null) parts.push(dec(recentSlg) + " SLG");

    return parts.join(" · ");
  }

  function tagChip(label, className) {
    return `<span class="matchup-chip ${esc(className)}">${esc(label)}</span>`;
  }

  function lineupSpotOf(row) {
    const value =
      row.lineupSpot ??
      row.battingOrder ??
      row.lineupOrder ??
      row.order ??
      row.projectedLineupSpot ??
      row.battingOrderSpot ??
      row.spot;

    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function pitcherHandTag(row) {
    const raw = String(
      row.pitcherHand ??
      row.opposingPitcherHand ??
      row.pitcherThrows ??
      row.throws ??
      row.vsHand ??
      ""
    ).toUpperCase();

    if (raw.includes("L")) return "VS LHP";
    if (raw.includes("R")) return "VS RHP";
    return "";
  }

  function extraMatchupTags(row) {
    const tags = [];
    const s = statsOf(row);
    const score = num(scoreOf(row));
    const hr = num(s.hr);
    const slg = num(s.slg);
    const ops = num(s.ops);
    const obp = num(s.obp);
    const rbi = num(s.rbi);
    const spot = lineupSpotOf(row);

    if (score >= 70 || hr >= 18 || slg >= .540 || ops >= .900) tags.push(["POWER", "tag-power tag-glow"]);
    if (slg >= .520 || ops >= .880) tags.push(["HIGH ISO", "tag-iso tag-glow"]);
    if (score >= 68 && slg >= .500) tags.push(["BARREL KING", "tag-barrel-king tag-glow"]);

    if (spot === 1) tags.push(["LEADOFF", "tag-speed tag-glow-soft"]);
    if (spot >= 1 && spot <= 3) tags.push(["TOP 3", "tag-top-order tag-glow-soft"]);
    if (spot === 4) tags.push(["CLEANUP", "tag-cleanup tag-glow"]);
    if (spot >= 3 && spot <= 5) tags.push(["HEART ORDER", "tag-cleanup tag-glow-soft"]);

    if (obp >= .360) tags.push(["HIGH OBP", "tag-contact"]);
    if (rbi >= 30) tags.push(["RBI SPOT", "tag-rbi"]);
    if (ops >= .850) tags.push(["OPS HEATER", "tag-hot tag-glow-soft"]);

    const speed =
      num(row.stolenBases) ||
      num(row.sb) ||
      num(row.stats?.hitter?.stolenBases) ||
      num(row.stats?.hitter?.sb);

    if (speed >= 8) tags.push(["SPEED", "tag-speed tag-glow-soft"]);

    const splitLabel =
      row.splitTag ||
      row.platoonTag ||
      row.handednessTag ||
      "";

    if (String(splitLabel).toLowerCase().includes("lefty")) tags.push(["LEFTY KILLER", "tag-split tag-glow"]);
    if (String(splitLabel).toLowerCase().includes("righty")) tags.push(["RIGHTY KILLER", "tag-split tag-glow"]);

    const pitcherStats = row?.stats?.pitcher || {};
    const pitcherEra = num(pitcherStats.era || pitcherStats.ERA);
    const pitcherWhip = num(pitcherStats.whip || pitcherStats.WHIP);
    const pitcherHr = num(pitcherStats.homeRuns || pitcherStats.hr);
    const pitcherIp = num(pitcherStats.inningsPitched || pitcherStats.ip);
    const hrPerNine = pitcherIp ? (pitcherHr / pitcherIp) * 9 : 0;

    const parkBoost = num(row.hrEnvironmentScore) >= 8 || [
      "Daikin Park",
      "Great American Ball Park",
      "Yankee Stadium",
      "Citizens Bank Park",
      "Coors Field",
      "Oriole Park at Camden Yards",
      "Fenway Park"
    ].includes(String(row.venue || ""));

    if (parkBoost) tags.push(["PARK BOOST", "tag-park tag-glow"]);
    if (num(row.pitchPunishment) >= 8) tags.push(["PITCH TYPE EDGE", "tag-pitch-edge tag-glow"]);
    if (num(row.hotZoneAttack) >= 8) tags.push(["HOT ZONE EDGE", "tag-hot-zone tag-glow"]);
    if (num(row.hrLeakFactor) >= 8 || hrPerNine >= 1.15) tags.push(["HR LEAK", "tag-leak tag-glow"]);
    if (pitcherEra >= 4.50 || pitcherWhip >= 1.35) tags.push(["PITCHER VULN", "tag-pitcher-vuln tag-glow-soft"]);

    const bullpen =
      num(row.bullpenBoost) ||
      num(row.bullpenScore) ||
      num(row.bullpenCollapseScore) ||
      num(row.weakBullpenScore);

    if (bullpen >= 8) tags.push(["WEAK BULLPEN", "tag-bullpen tag-glow"]);

    const recentTrend = num(row.recentHRTrend);
    const barrelScore = num(row.barrelScore);
    const hardHitScore = num(row.hardHitScore);
    const truePower = num(row.truePowerScore);
    const volatility = num(row.hrVolatilityScore);
    const confidence = num(row.hrConfidence);

    if (
      barrelScore >= 80 &&
      hardHitScore >= 75 &&
      recentTrend <= 8 &&
      hr <= 12
    ) {
      tags.push(["DUE", "tag-due tag-glow"]);
    }

    if (
      truePower >= 45 &&
      volatility >= 55 &&
      confidence >= 50 &&
      recentTrend <= 10
    ) {
      tags.push(["POWER DUE", "tag-due tag-glow"]);
    }

    if (
      barrelScore >= 90 &&
      hardHitScore >= 90 &&
      recentTrend <= 14
    ) {
      tags.push(["BREAKOUT WATCH", "tag-breakout tag-glow-soft"]);
    }

    const windText = String(row.weatherWind || row.wind || row.windDirection || row.windTag || "").toUpperCase();
    if (windText.includes("OUT") || windText.includes("CARRY")) tags.push(["WIND OUT", "tag-wind tag-glow"]);

    return tags.slice(0, 7);
  }

  function matchupBadges(row) {
    const level = matchupLevel(row);
    const previous = previousHrVsPitcher(row);
    const hand = pitcherHandTag(row);
    const recent = recentLabel(row);

    const chips = [
      [level, "level-" + level.toLowerCase()],
      ...(previous > 0 ? [["CRUSHER", "crusher tag-glow"]] : []),
      [barrelLabel(row), "barrel"],
      [hardHitLabel(row), "hardhit"],
      ...(hand ? [[hand, "vs"]] : []),
      ...(recent ? [[recent, "recent tag-glow-soft"]] : []),
      ...extraMatchupTags(row)
    ];

    const seen = new Set();
    const html = chips
      .filter(([label]) => {
        const key = String(label || "").toUpperCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12)
      .map(([label, className]) => tagChip(label, className))
      .join("");

    return `<div class="matchup-badges">${html}</div>`;
  }


  function allHitters(game) {
    return [...(game.hitters?.away || []), ...(game.hitters?.home || [])];
  }

  function pitcherObj(game, side) {
    return side === "away" ? game.awayPitcher : game.homePitcher;
  }

  function pitcherName(game, side) {
    const pitcher = pitcherObj(game, side);
    const name = pitcher?.name || pitcher?.pitcher || "";
    return name && name !== "TBD" ? name : "";
  }

  function hasRealPitcher(game, side) {
    return pitcherName(game, side).length > 0;
  }

  function pitcherStatsFor(game, side) {
    const pitcher = pitcherObj(game, side);
    const sideStats = side === "away" ? game.awayPitcherStats : game.homePitcherStats;
    const hitters = side === "away" ? game.hitters?.home || [] : game.hitters?.away || [];
    const hitterPitcherStats = hitters.find(row => row?.stats?.pitcher)?.stats?.pitcher || null;

    return pitcher?.stats || sideStats || hitterPitcherStats || {};
  }

  function pitcherEra(game, side) {
    const pitcher = pitcherObj(game, side);
    const stats = pitcherStatsFor(game, side);

    const value =
      pitcher?.era ??
      pitcher?.pitcherEra ??
      stats?.era ??
      stats?.ERA ??
      null;

    return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "Pending";
  }

  function pitcherVulnerability(game, side) {
    const pitcher = pitcherObj(game, side);
    if (pitcher && pitcher.vulnerability !== undefined) return num(pitcher.vulnerability);

    const hitters = side === "away" ? game.hitters?.home || [] : game.hitters?.away || [];
    const top = hitters.slice(0, 5);

    return top.length ? top.reduce((sum, row) => sum + num(scoreOf(row)), 0) / top.length : 0;
  }

  function topPitcherRows() {
    return state.games.flatMap(game => [
      { game, side: "away", pitcher: pitcherName(game, "away"), team: game.awayTeam, opponent: game.homeTeam, score: pitcherVulnerability(game, "away") },
      { game, side: "home", pitcher: pitcherName(game, "home"), team: game.homeTeam, opponent: game.awayTeam, score: pitcherVulnerability(game, "home") }
    ])
    .filter(row => row.pitcher && row.pitcher !== "TBD" && row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  }

  function injectShell() {
    const wrap = document.querySelector("main.wrap");
    if (!wrap) return;
    for (const id of ["hero", "tabs", "games", "grid", "topVulnPanel"]) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }
    const sub = wrap.querySelector(".sub");
    sub.insertAdjacentHTML("afterend", `
      <section class="panel" id="topVulnPanel">
        <div class="panel-head"><div class="panel-title">Top Vulnerabilities <span id="avgVuln">Loading</span></div><div class="panel-note">click to jump</div></div>
        <div class="vulns" id="vulns"></div>
      </section>
      <section class="hero" id="hero">Loading today’s live slate</section>
      <div class="tabs" id="tabs"></div>
      <section class="games" id="games"></section>
    `);
  }

  function projectedSlateHRs(rows) {
    const games = state.games.length || 0;
    if (!games) return 0;

    const avgVulnerability = rows.length
      ? rows.reduce((sum, row) => sum + num(row.score), 0) / rows.length
      : 50;

    const highValue = rows.filter(row => row.score >= 45).length;

    const baseline = games * 2.2;
    const vulnerabilityBoost = Math.max(-4, Math.min(8, (avgVulnerability - 50) * 0.2));
    const highValueBoost = highValue * 0.75;

    const projected = baseline + vulnerabilityBoost + highValueBoost;

    return Math.max(games * 1.6, Math.min(games * 3.2, projected));
  }

  function renderTopVulnerabilities() {
    const rows = topPitcherRows();
    const highValue = rows.filter(row => row.score >= 45).length;
    const projectedHRs = projectedSlateHRs(rows);
    const avgPerGame = state.games.length ? projectedHRs / state.games.length : 0;

    let environment = "LOW HR ENVIRONMENT";

    if (projectedHRs >= 46) {
      environment = "EXTREME HR ENVIRONMENT";
    } else if (projectedHRs >= 40) {
      environment = "HIGH HR ENVIRONMENT";
    } else if (projectedHRs >= 34) {
      environment = "ELEVATED HR ENVIRONMENT";
    } else if (projectedHRs >= 28) {
      environment = "AVERAGE HR ENVIRONMENT";
    }

    const avgVuln = document.getElementById("avgVuln");
    avgVuln.innerHTML =
      ` | 🔥 <span class="vuln-proj-number" data-target="${projectedHRs.toFixed(1)}">0.0</span> Projected Home Runs Today <span class="vuln-env-tag">${esc(environment)}</span> ${avgPerGame.toFixed(2)} HR/Game • ${highValue} High Value Games`;

    animateProjectedHRNumber();

    document.getElementById("vulns").innerHTML = rows.length ? rows.map((row, index) => {
      const label = vulnerabilityTier(row.score).label;
      return `
        <button class="vuln" data-game="${state.games.indexOf(row.game)}" type="button">
          <div class="vuln-line">
            <small>#${index + 1}</small>
            <b data-score="${Math.round(row.score)}">${Math.round(row.score)}</b>
            <span>${label}</span>
          </div>
          <strong>${esc(row.pitcher)}</strong>
          <em>${esc(code(row.team))} vs ${esc(code(row.opponent))} · ERA ${esc(pitcherEra(row.game, row.side))}</em>
        </button>
      `;
    }).join("") : `<div class="empty">Pitcher vulnerability data is still updating.</div>`;

    document.querySelectorAll(".vuln[data-game]").forEach(button => {
      button.addEventListener("click", () => {
        state.active = button.dataset.game;
        render();
        document.getElementById("games")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function animateProjectedHRNumber() {
    const node = document.querySelector(".vuln-proj-number[data-target]");
    if (!node) return;

    const target = Number(node.dataset.target || 0);
    const start = performance.now();
    const duration = 1800;

    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = (target * eased).toFixed(1);

      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  function renderTabs() {
    const tabs = document.getElementById("tabs");
    tabs.innerHTML = `<button class="${state.active === "all" ? "active" : ""}" data-game="all">All Games<span>${state.games.length} games</span></button>` +
      state.games.map((game, index) => `
        <button class="${String(state.active) === String(index) ? "active" : ""}" data-game="${index}">
          ${esc(code(game.awayTeam))} at ${esc(code(game.homeTeam))}<span>${esc(gameTime(game))}</span>
        </button>
      `).join("");
    tabs.querySelectorAll("button").forEach(button => {
      button.addEventListener("click", () => {
        state.active = button.dataset.game;
        render();
      });
    });
  }

  function statGrid(row) {
    const s = statsOf(row);
    return `
      <div class="player-stat-grid">
        ${metric("HR", s.hr)}${metric("AVG", dec(s.avg))}${metric("OBP", dec(s.obp))}
        ${metric("SLG", dec(s.slg))}${metric("OPS", dec(s.ops))}${metric("RBI", s.rbi)}
      </div>
    `;
  }

  function metric(label, value) {
    return `<div class="player-stat"><label>${esc(label)}</label><b>${esc(show(value))}</b></div>`;
  }

  function renderBat(row, index) {
    const s = statsOf(row);
    const note = row.note || (Array.isArray(row.reasons) ? row.reasons.join(" + ") : "matchup context warrants monitoring");
    return `
      <article class="bat sweet-bat" data-player-id="${esc(row.playerId || "")}" data-player="${esc(row.player || "")}">
        <div class="face">${esc(initials(row.player))}</div>
        <div class="sweet-main">
          <div class="bat-name">#${esc(row.rank || index + 1)} ${esc(row.player)}</div>
          ${matchupBadges(row)}
          <div class="sweet-note">${esc(note)}</div>
          ${(row.why || row.matchupWhy) ? `<div class="sweet-why">Why this matters: ${esc(row.why || row.matchupWhy)}</div>` : ""}
          <div class="sweet-l7" data-player-id="${esc(row.playerId || "")}">L7 loading</div>
          ${statGrid(row)}
        </div>
        <div class="score sweet-score"><b>${esc(scoreOf(row))}</b><br/>score<br/><span>${esc(dec(s.slg))} SLG</span></div>
      </article>
    `;
  }

  function renderSide(game, side) {
    const away = side === "away";
    const pitcherTeam = away ? game.awayTeam : game.homeTeam;
    const hitterTeam = away ? game.homeTeam : game.awayTeam;
    const pitcher = away ? game.awayPitcher : game.homePitcher;
    const hitters = (away ? game.hitters?.home || [] : game.hitters?.away || [])
      .slice()
      .sort((a, b) => num(scoreOf(b)) - num(scoreOf(a)));
    const lineup = away ? game.homeBattingOrder || [] : game.awayBattingOrder || [];
    const lineupStatus = away ? game.homeLineupStatus : game.awayLineupStatus;
    const lineupText = lineup.length ? lineup.length + "/9" : (String(lineupStatus || "").includes("CONFIRMED") ? "Posted" : hitters.length ? "Projected" : "Pending");
    const pitcherLabel = pitcher?.name || pitcher?.pitcher || "TBD";
    const hand = pitcher?.side || pitcher?.throws || "";
    const vuln = pitcherVulnerability(game, side);
    const vulnClass = vulnerabilityTier(vuln).className;
    return `
      <article class="side ${vulnClass}">
        <div class="side-top"><div>
          <div class="pitcher">${esc(pitcherLabel)}</div>
          <div class="pitcher-sub">${esc(code(pitcherTeam))}${hand ? " • " + esc(hand) : ""} • vs ${esc(code(hitterTeam))}</div>
          <div class="mini"><div><label>Team</label><b>${esc(code(pitcherTeam))}</b></div><div><label>Bats</label><b>${hitters.length}</b></div><div><label>Lineup</label><b>${esc(lineupText)}</b></div><div><label>Vuln</label><b>${whole(vuln)}</b></div></div>
        </div><div class="vbox"><b>${whole(vuln)}</b><span>VULN</span></div></div>
        <div class="danger"><div class="danger-head"><span>Danger Batters</span><span>${hitters.length} bats</span></div><div class="bats">${hitters.slice(0, 8).map(renderBat).join("") || `<div class="empty">No hitter data yet for ${esc(hitterTeam)}</div>`}</div></div>
      </article>
    `;
  }

  function renderGame(game, index) {
    return `
      <section class="game-card" data-game="${index}">
        <div class="game-head"><div><h2>${esc(game.awayTeam)} at ${esc(game.homeTeam)}</h2><div class="game-meta">${esc(gameTime(game))}${game.venue ? " • " + esc(game.venue) : ""}${game.status ? " • " + esc(game.status) : ""}</div></div><div class="pill ${lineupStatusLabel(game).toLowerCase()}">${esc(lineupStatusLabel(game))}</div></div>
        <div class="matchup-grid">${renderSide(game, "away")}${renderSide(game, "home")}</div>
        ${renderWeather(game.weather)}
      </section>
    `;
  }

  function renderWeather(weather) {
    if (!weather) return "";
    return `<div class="weather"><b>Weather</b><span>${esc(weather.temp)}°F</span><span>${esc(weather.windSpeed)} mph ${esc(weather.windCompass)}</span><span>${esc(weather.humidity)}% humidity</span><span>${esc(weather.status || "live")}</span></div>`;
  }

  function render() {
    injectVulnerabilityStyles();
    renderTopVulnerabilities();
    renderTabs();
    document.getElementById("hero").innerHTML = `<b>${state.games.length}</b> games loaded today from the daily matchup engine`;
    const visible = state.active === "all" ? state.games : state.games.filter((_, index) => String(index) === String(state.active));
    document.getElementById("games").innerHTML = visible.map(renderGame).join("") || '<div class="error">No games loaded. Run the MLB refresh.</div>';
    wireCards();
    hydrateLast7();
  }

  function wireCards() {
    document.querySelectorAll(".bat").forEach(card => {
      card.addEventListener("click", () => {
        const playerId = card.dataset.playerId;
        const player = card.dataset.player;
        const row = state.games.flatMap(allHitters).find(h => String(h.playerId || "") === String(playerId || "") || h.player === player);
        if (row) openModal(row);
      });
    });
  }

  function sprayFor(row) {
    return state.spray?.byPlayerId?.[String(row.playerId || "")] || state.spray?.players?.[row.player] || null;
  }

  function spraySvg(row) {
    const chart = sprayFor(row);
    const points = chart?.points || [];
    const dots = points.slice(-180).map(point => {
      const x = Math.max(25, Math.min(335, num(point.x) * 1.2));
      const y = Math.max(25, Math.min(285, num(point.y) * 1.15));
      const color = point.type === "hr" ? "#ff6374" : point.type === "xbh" ? "#ffd25a" : point.type === "hit" ? "#00e0a4" : "#6eb7ff";
      return `<circle cx="${x}" cy="${y}" r="${point.type === "hr" ? 5 : 3}" fill="${color}" opacity=".9"></circle>`;
    }).join("");
    const title = chart?.summary ? `Real Statcast Spray Chart • ${esc(chart.summary.battedBalls)} batted balls • ${esc(chart.summary.homeRuns)} HR` : "Spray Chart data not built yet";
    return `<div class="section-title">${title}</div><div class="spray"><svg viewBox="0 0 360 310"><path d="M180 285 L55 115 Q180 35 305 115 Z" fill="rgba(140,255,50,.09)" stroke="rgba(140,255,50,.35)"/><path d="M180 285 L180 62 M180 285 L95 125 M180 285 L265 125" stroke="rgba(255,255,255,.18)"/><circle cx="180" cy="285" r="5" fill="#fff"/>${dots}</svg></div>`;
  }

  function ensureModal() {
    if (document.getElementById("modalBg")) return;
    document.body.insertAdjacentHTML("beforeend", '<div class="modal-bg" id="modalBg"><aside class="modal"><div class="modal-head"><div class="modal-player"><div class="modal-face" id="mFace"></div><div><h2 id="mName"></h2><div class="modal-sub" id="mSub"></div></div></div><button class="close" id="mClose">Close</button></div><div class="metric-grid" id="mMetrics"></div><div id="mContent"></div></aside></div>');
    document.getElementById("mClose").onclick = () => document.getElementById("modalBg").classList.remove("open");
    document.getElementById("modalBg").onclick = event => { if (event.target.id === "modalBg") event.target.classList.remove("open"); };
  }

  function openModal(row) {
    ensureModal();
    const s = statsOf(row);
    document.getElementById("mFace").textContent = initials(row.player);
    document.getElementById("mName").textContent = row.player || "Player";
    document.getElementById("mSub").textContent = `${row.team || ""} vs ${row.opponent || ""}${row.opposingPitcher ? " • vs " + row.opposingPitcher : ""}`;
    document.getElementById("mMetrics").innerHTML = [
      ["HR", s.hr], ["AVG", dec(s.avg)], ["OBP", dec(s.obp)], ["SLG", dec(s.slg)], ["OPS", dec(s.ops)], ["RBI", s.rbi], ["Hits", s.hits], ["Score", scoreOf(row)]
    ].map(item => `<div class="metric"><label>${esc(item[0])}</label><b>${esc(show(item[1]))}</b></div>`).join("");
    document.getElementById("mContent").innerHTML = spraySvg(row);
    document.getElementById("modalBg").classList.add("open");
  }

  function injectStyles() {
    if (document.getElementById("slateFullRendererStyles")) return;
    const style = document.createElement("style");
    style.id = "slateFullRendererStyles";
    style.textContent = `.panel{background:#090a10;border:1px solid rgba(255,255,255,.08);border-radius:6px;overflow:hidden;margin-bottom:22px}.panel-head{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;border-bottom:1px solid rgba(255,255,255,.07)}.panel-title{font-size:11px;letter-spacing:.32em;color:#9ba1ad;text-transform:uppercase;font-weight:950}.panel-title span{letter-spacing:0;text-transform:none;color:#ff6b2d;margin-left:12px;font-size:13px}.panel-note{color:#4c515c;font-weight:800;font-size:11px}.vulns{display:grid;grid-template-columns:repeat(5,1fr)}.vuln{appearance:none;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:18px 20px;border:0;border-right:1px solid rgba(255,255,255,.07)}.vuln-line{display:flex;align-items:center;gap:9px;margin-bottom:8px}.vuln small{color:#00e083;font-weight:950;font-size:12px}.vuln b{
          position: relative;
          z-index: 1;
          filter: drop-shadow(0 0 10px currentColor) drop-shadow(0 0 24px currentColor);
        }

        .vuln b::before{
          content: attr(data-score);
          position: absolute;
          inset: 0;
          z-index: -1;
          color: currentColor;
          opacity: .95;
          filter: blur(10px);
          transform: scale(1.18);
        }

        .vuln:first-child b::before{
          opacity: 1;
          filter: blur(13px);
          transform: scale(1.24);
        }

        .vuln b{color:#ff4d63;font-size:23px;line-height:1;font-weight:950}.vuln span{border:1px solid #ff4d63;color:#ff4d63;border-radius:5px;padding:4px 7px;font-size:10px;font-weight:950;letter-spacing:.18em}.vuln:nth-child(n+2) b{color:#ff8a00}.vuln:nth-child(n+2) small{color:#ffc400}.vuln:nth-child(n+2) span{border-color:#ff8a00;color:#ff8a00}.vuln strong{display:block;font-size:15px;color:#f2f2f2;margin-bottom:5px}.vuln em{display:block;color:#555b66;font-style:normal;font-size:11px;font-weight:800}.player-stat-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin:7px 0}.sweet-bat{cursor:pointer;background:linear-gradient(110deg,rgba(130,70,20,.42),rgba(18,12,24,.88));border-left:3px solid #ffb000}.sweet-bat:nth-child(even){background:linear-gradient(110deg,rgba(65,18,96,.55),rgba(9,15,18,.9));border-left-color:#b36cff}.sweet-main{min-width:0}.matchup-badges{display:flex;flex-wrap:wrap;gap:5px;margin:5px 0 8px}.matchup-chip{border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 7px;font-size:10px;font-weight:950;line-height:1;color:#fff;background:rgba(255,255,255,.07)}.matchup-chip.level-elite{background:#ff6b00;border-color:#ff9a38;color:#fff}.matchup-chip.level-high{background:#ff7a00;border-color:#ffb15a;color:#fff}.matchup-chip.level-mid{background:#ffb000;border-color:#ffd15a;color:#130b00}.matchup-chip.crusher{background:#9c27b0;border-color:#e05cff;color:#fff}.matchup-chip.barrel{background:rgba(255,122,0,.18);border-color:#ff7a00;color:#ffb000}.matchup-chip.hardhit{background:rgba(255,60,80,.18);border-color:#ff3c50;color:#ff7c88}.matchup-chip.vs{background:rgba(20,35,50,.85);border-color:#5d7188;color:#b8c6d4}.matchup-chip.recent{background:rgba(255,122,0,.12);border-color:#b65a00;color:#ff9d18}
.matchup-chip.tag-power{background:rgba(255,55,70,.18);border-color:#ff3c50;color:#ff7c88}
.matchup-chip.tag-iso{background:rgba(255,122,0,.20);border-color:#ff8a00;color:#ffb000}
.matchup-chip.tag-barrel-king{background:rgba(255,176,0,.20);border-color:#ffd15a;color:#ffe08a}
.matchup-chip.tag-cleanup{background:rgba(255,176,0,.18);border-color:#ffc400;color:#ffd95a}
.matchup-chip.tag-speed{background:rgba(0,224,164,.16);border-color:#00e0a4;color:#42ffd7}
.matchup-chip.tag-top-order{background:rgba(0,140,255,.16);border-color:#2296ff;color:#74c7ff}
.matchup-chip.tag-contact{background:rgba(0,224,164,.12);border-color:#00a77b;color:#8fffe0}
.matchup-chip.tag-rbi{background:rgba(255,80,130,.14);border-color:#ff5082;color:#ff9abb}
.matchup-chip.tag-hot{background:rgba(255,70,40,.18);border-color:#ff6b2d;color:#ffb199}
.matchup-chip.tag-split{background:rgba(179,108,255,.18);border-color:#b36cff;color:#d9b8ff}.matchup-chip.tag-park{background:rgba(255,176,0,.20);border-color:#ffd15a;color:#ffe08a}
.matchup-chip.tag-pitch-edge{background:rgba(255,70,40,.20);border-color:#ff6b2d;color:#ffc1a8}
.matchup-chip.tag-hot-zone{background:rgba(255,55,70,.18);border-color:#ff3c50;color:#ff9aa5}
.matchup-chip.tag-leak{background:rgba(255,0,85,.18);border-color:#ff3c80;color:#ff9abc}
.matchup-chip.tag-pitcher-vuln{background:rgba(255,122,0,.16);border-color:#ff8a00;color:#ffbd66}
.matchup-chip.tag-bullpen{background:rgba(255,40,110,.18);border-color:#ff4f91;color:#ff9fc2}
.matchup-chip.tag-wind{background:rgba(0,180,255,.18);border-color:#36c8ff;color:#9ee8ff}.matchup-chip.tag-due{background:rgba(255,0,90,.22);border-color:#ff3c80;color:#ffb0cc}
.matchup-chip.tag-breakout{background:rgba(255,210,80,.18);border-color:#ffd250;color:#ffe7a0}
.matchup-chip.tag-glow{box-shadow:0 0 10px currentColor,0 0 22px rgba(255,255,255,.18)}
.matchup-chip.tag-glow-soft{box-shadow:0 0 8px currentColor,0 0 16px rgba(255,255,255,.12)}
.sweet-note{color:#c8c8c8;font-size:12px;font-style:italic;margin-top:4px}.sweet-why{color:#ff6b2d;font-size:11px;font-weight:800;margin-top:4px}.sweet-l7{color:#00e0a4;font-size:11px;font-weight:850;margin-top:4px}.sweet-score{color:#fff}.player-stat{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:7px;padding:5px;text-align:center}.player-stat label{display:block;font-size:8px;color:#8fa09a;font-weight:950}.player-stat b{font-size:11px;color:#8cff32}.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:5000;justify-content:flex-end}.modal-bg.open{display:flex}.modal{width:min(620px,96vw);height:100vh;overflow:auto;background:#061010;border-left:1px solid rgba(140,255,50,.3);padding:18px}.modal-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}.modal-player{display:flex;gap:12px;align-items:center}.modal-face{width:54px;height:54px;border-radius:50%;background:#17272b;border:1px solid rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-weight:950}.modal h2{font-size:24px}.modal-sub{color:#9aaba4;font-size:13px;margin-top:4px}.close{background:#11191b;border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:10px;padding:9px 11px;font-weight:950;cursor:pointer}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;margin-bottom:12px}.metric{padding:11px;text-align:center;border-right:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06)}.metric label{display:block;color:#8fa09a;font-size:9px;font-weight:950;margin-bottom:5px}.metric b{color:#8cff32}.section-title{font-size:12px;letter-spacing:.14em;color:#8cff32;text-transform:uppercase;font-weight:950;margin:16px 0 10px}.spray svg{width:100%;height:310px;background:#071111;border:1px solid rgba(255,255,255,.07);border-radius:14px}@media(max-width:1050px){.vulns{grid-template-columns:repeat(2,1fr)}.player-stat-grid{grid-template-columns:repeat(3,1fr)}}`;
    document.head.appendChild(style);
  }

  async function load() {
    injectStyles();
    injectShell();
    state.games = sortGamesByFirstPitch(await json("./data/game_pitcher_matchups.json", null));
    state.spray = await json("./data/player_spray_charts.json", {});
    render();
  }

  load();
})();
