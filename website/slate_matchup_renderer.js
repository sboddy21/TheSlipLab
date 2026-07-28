(() => {
  const state = { games: [], schedule: null, health: null, spray: {}, weather: [], bullpen: [], probabilitiesByName: new Map(), aiSays: {}, active: "all", last7: {}, playerCardsById: new Map(), playerCardsByName: new Map(), market: "hr", marketRows: { hits: [], tb: [], rbis: [], pitcherKs: [] }, filters: { search: "", team: "all", minProjection: 0, minScore: 0 }, selectedGameKeys: new Set(), comparisonOpen: false, selectionMessage: "" };

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
  const whole = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Math.round(Number(value)) : "N/A";
  const dec = value => Number.isFinite(Number(value)) ? Number(value).toFixed(3).replace(/^0/, "") : "N/A";
  const initials = value => String(value || "").split(" ").map(x => x[0]).join("").slice(0, 2).toUpperCase();
  const playerNameKey = value => String(value || "").trim().toLowerCase();
  const comparisonStorageKey = "the-slip-lab:five-game-comparison:v1";

  function restoreGameComparison() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(comparisonStorageKey) || "[]");
      state.selectedGameKeys = new Set(Array.isArray(saved) ? saved.map(String).slice(0, 5) : []);
    } catch {
      state.selectedGameKeys = new Set();
    }
  }

  function saveGameComparison() {
    try {
      sessionStorage.setItem(comparisonStorageKey, JSON.stringify([...state.selectedGameKeys].slice(0, 5)));
    } catch {
      // The comparison remains usable when browser storage is unavailable.
    }
  }

  function indexPlayerCards(payload) {
    state.playerCardsById.clear();
    state.playerCardsByName.clear();
    state.last7 = {};

    for (const card of rows(payload)) {
      const id = String(card?.playerId || "").trim();
      const name = playerNameKey(card?.player);
      if (id) state.playerCardsById.set(id, card);
      if (name) state.playerCardsByName.set(name, card);
      if (id && card?.last7) state.last7[id] = card.last7;
    }
  }

  function playerCardFor(row) {
    const id = String(row?.playerId || "").trim();
    if (id && state.playerCardsById.has(id)) return state.playerCardsById.get(id);
    return state.playerCardsByName.get(playerNameKey(row?.player)) || null;
  }

  function slateSignalsFor(row) {
    const card = playerCardFor(row);
    return Array.isArray(card?.slateSignals) ? card.slateSignals : [];
  }

  function signalClassName(key) {
    return `signal-${String(key || "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`;
  }

  function vulnerabilityTier(score) {
    if (score === null || score === undefined || score === "") return { label: "N/A", className: "vuln-unavailable" };
    const v = num(score);

    if (v >= 60) return { label: "HIGH", className: "vuln-high" };
    if (v >= 45) return { label: "ELEVATED", className: "vuln-medhigh" };
    if (v >= 30) return { label: "WATCH", className: "vuln-medium" };

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

        body.tsl-editorial .side.vuln-high,
        body.tsl-editorial .side.vuln-high .side-top,
        body.tsl-editorial .side.vuln-medhigh,
        body.tsl-editorial .side.vuln-medhigh .side-top,
        body.tsl-editorial .side.vuln-medium,
        body.tsl-editorial .side.vuln-medium .side-top,
        body.tsl-editorial .side.vuln-low,
        body.tsl-editorial .side.vuln-low .side-top {
          background: #fffdf7 !important;
        }

        body.tsl-editorial .side.vuln-high { border-left: 6px solid #ff5425 !important; }
        body.tsl-editorial .side.vuln-medhigh { border-left: 6px solid #f39a1d !important; }
        body.tsl-editorial .side.vuln-medium { border-left: 6px solid #1268f3 !important; }
        body.tsl-editorial .side.vuln-low { border-left: 6px solid #667789 !important; }

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

        .market-filter-panel {
          display: grid;
          grid-template-columns: minmax(220px, 1.4fr) repeat(3, minmax(130px, .7fr)) auto;
          gap: 9px;
          margin: 0 0 12px;
        }

        .market-filter-panel input,
        .market-filter-panel select,
        .market-filter-panel button {
          background: #101719;
          color: #f4fff8;
          border: 1px solid rgba(255,255,255,.12);
          border-radius: 10px;
          padding: 10px 11px;
          font-size: 12px;
          font-weight: 850;
          outline: none;
        }

        .market-filter-panel button {
          cursor: pointer;
          color: #8cff32;
          border-color: rgba(140,255,50,.35);
        }

        .market-filter-panel input:focus,
        .market-filter-panel select:focus {
          border-color: rgba(140,255,50,.55);
          box-shadow: 0 0 0 2px rgba(140,255,50,.08);
        }

        .pitcher-intel { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:7px; padding:10px 14px; border-top:1px solid rgba(255,255,255,.07); border-bottom:1px solid rgba(255,255,255,.07); }
        .pitcher-intel div { min-width:0; }
        .pitcher-intel label { display:block; color:#7f8f88; font-size:8px; font-weight:950; letter-spacing:.08em; text-transform:uppercase; }
        .pitcher-intel b { display:block; margin-top:2px; color:#f3faf7; font-size:12px; }
        .pitcher-context { padding:9px 14px; color:#a4b2ad; font-size:10px; font-weight:850; }
        .pitcher-context b { color:#8cff32; }
        body.tsl-editorial .pitcher-intel { border-color:#d2d8da; }
        body.tsl-editorial .pitcher-intel label, body.tsl-editorial .pitcher-context { color:#526579; }
        body.tsl-editorial .pitcher-intel b { color:#071d36; }
        body.tsl-editorial .pitcher-context b { color:#075d4c; }

        @media(max-width:900px) {
          .market-filter-panel {
            grid-template-columns: 1fr;
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

  function finiteNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function gameKey(game) {
    if (game?.gamePk !== undefined && game?.gamePk !== null && game?.gamePk !== "") return String(game.gamePk);
    return [game?.gameDate, game?.awayTeam, game?.homeTeam].map(value => String(value || "")).join("|");
  }

  function selectedGames() {
    return state.games.filter(game => state.selectedGameKeys.has(gameKey(game)));
  }

  function topHitterForGame(game) {
    return allHitters(game)
      .map(row => ({ row, score: finiteNumber(scoreOf(row)) }))
      .filter(item => item.score !== null)
      .sort((a, b) => b.score - a.score)[0] || null;
  }

  function topTargetsForGame(game, limit = 3) {
    return allHitters(game)
      .map(row => ({ row, score: finiteNumber(scoreOf(row)) }))
      .filter(item => item.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  function bullpenLeaderForTeam(team) {
    return state.bullpen
      .filter(row => String(row?.team || "") === String(team || ""))
      .map(row => ({ row, score: finiteNumber(row?.hrRiskScore) }))
      .filter(item => item.score !== null)
      .sort((a, b) => b.score - a.score)[0] || null;
  }

  function pitcherRiskSummary(game) {
    const away = finiteNumber(pitcherVulnerability(game, "away"));
    const home = finiteNumber(pitcherVulnerability(game, "home"));
    const available = [
      away === null ? null : { pitcher: pitcherName(game, "away"), team: game.awayTeam, score: away },
      home === null ? null : { pitcher: pitcherName(game, "home"), team: game.homeTeam, score: home }
    ].filter(Boolean).sort((a, b) => b.score - a.score);
    return available[0] || null;
  }

  function comparisonWeather(game) {
    const weather = weatherForVenue(game?.venue);
    if (!weather) return "Updating";
    const details = [];
    const temp = finiteNumber(weather.temp ?? weather.temperature);
    const wind = finiteNumber(weather.windSpeed ?? weather.wind_speed);
    if (temp !== null) details.push(`${Math.round(temp)}°F`);
    if (wind !== null) details.push(`${wind} mph${weather.windCompass ? ` ${weather.windCompass}` : ""}`);
    if (weather.status) details.push(String(weather.status));
    return details.length ? details.join(" · ") : "Updating";
  }

  function probabilityForRow(row) {
    const value = state.probabilitiesByName.get(playerNameKey(row?.player));
    return Number.isFinite(value) ? value : null;
  }

  function topProbabilityForGame(game) {
    return allHitters(game)
      .map(row => ({ row, score: probabilityForRow(row) }))
      .filter(item => item.score !== null)
      .sort((a, b) => b.score - a.score)[0] || null;
  }

  function weatherEnvironmentForGame(game) {
    const scores = allHitters(game)
      .map(row => finiteNumber(row?.hrEnvironmentScore))
      .filter(value => value !== null);
    return scores.length ? Math.max(...scores) : null;
  }

  function gameComparisonSnapshot(game) {
    const risk = pitcherRiskSummary(game);
    const topHitter = topHitterForGame(game);
    const topProbability = topProbabilityForGame(game);
    const bullpen = [bullpenLeaderForTeam(game.awayTeam), bullpenLeaderForTeam(game.homeTeam)]
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)[0] || null;

    return {
      game,
      key: gameKey(game),
      risk,
      topHitter,
      topProbability,
      bullpen,
      weatherEnvironment: weatherEnvironmentForGame(game),
      lineup: lineupStatusLabel(game)
    };
  }

  function comparisonLeaders(snapshots) {
    const leader = selector => snapshots
      .map(snapshot => ({ snapshot, value: selector(snapshot) }))
      .filter(item => Number.isFinite(Number(item.value)))
      .sort((a, b) => b.value - a.value)[0] || null;

    return [
      { label: "Highest pitcher risk", item: leader(snapshot => snapshot.risk?.score ?? null), value: item => whole(item.snapshot.risk.score) },
      { label: "Strongest top hitter", item: leader(snapshot => snapshot.topHitter?.score ?? null), value: item => `${item.snapshot.topHitter.row.player} · ${whole(item.snapshot.topHitter.score)}` },
      { label: "Highest HR probability", item: leader(snapshot => snapshot.topProbability?.score ?? null), value: item => `${item.snapshot.topProbability.row.player} · ${item.snapshot.topProbability.score.toFixed(1)}%` },
      { label: "Highest HR environment", item: leader(snapshot => snapshot.weatherEnvironment), value: item => whole(item.snapshot.weatherEnvironment) },
      { label: "Highest bullpen risk", item: leader(snapshot => snapshot.bullpen?.score ?? null), value: item => whole(item.snapshot.bullpen.score) }
    ].filter(entry => entry.item);
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
    return state.last7[id] || null;
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

    return "";
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

    return "";
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

  function playerNameOf(row) {
    return String(
      row.player ||
      row.playerName ||
      row.name ||
      row.hitter ||
      row.batter ||
      ""
    ).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function lineupSpotOf(row) {
    const playerKey = playerNameOf(row);

    const confirmed =
      row.confirmedLineupSpot ??
      row.confirmedSpot ??
      row.actualLineupSpot ??
      row.actualSpot ??
      row.lineupSpot ??
      row.battingOrder ??
      row.lineupOrder ??
      row.order;

    if (Number.isFinite(Number(confirmed)) && Number(confirmed) > 0) {
      return Number(confirmed);
    }

    const projected =
      row.projectedLineupSpot ??
      row.projectedSpot ??
      row.battingOrderSpot ??
      row.spot;

    return Number.isFinite(Number(projected)) ? Number(projected) : 0;
  }

  function lineupSpotLabel(row) {
    const spot = lineupSpotOf(row);
    if (!spot) return "Lineup Pending";

    const confirmed =
      row.confirmedLineupSpot ??
      row.confirmedSpot ??
      row.actualLineupSpot ??
      row.actualSpot ??
      row.lineupSpot ??
      row.battingOrder ??
      row.lineupOrder ??
      row.order;

    const isConfirmed = Number.isFinite(Number(confirmed)) && Number(confirmed) > 0;

    return isConfirmed ? "Confirmed #" + spot : "Projected #" + spot;
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

  function weatherForVenue(venue) {
    const key = String(venue || "").toLowerCase().trim();
    if (!key) return null;

    return state.weather.find(row =>
      String(row.venue || row.ballpark || row.stadium || "").toLowerCase().trim() === key
    ) || null;
  }

  function windOutLabel(weather) {
    const text = String(
      weather?.windImpact ||
      weather?.impact ||
      weather?.windTag ||
      weather?.carryTag ||
      weather?.windCompass ||
      weather?.windDirection ||
      ""
    ).toUpperCase();

    if (text.includes("OUT TO LF")) return "WIND OUT LF";
    if (text.includes("OUT TO RF")) return "WIND OUT RF";
    if (text.includes("OUT TO CF")) return "WIND OUT CF";
    if (text.includes("BLOWING OUT")) return "WIND OUT";
    if (text.includes("CARRY")) return "WIND CARRY";

    const degrees = num(weather?.arrowDegrees || weather?.windDirection);
    if (degrees >= 330 || degrees < 30) return "WIND OUT CF";
    if (degrees >= 30 && degrees < 75) return "WIND OUT RF";
    if (degrees >= 285 && degrees < 330) return "WIND OUT LF";

    return "";
  }

  function weatherTagsForRow(row) {
    const tags = [];
    const weather = weatherForVenue(row.venue || row.gameVenue);
    if (!weather) return tags;

    const roof = String(weather.roofStatus || weather.roof || "").toUpperCase();
    const temp = num(weather.temp || weather.temperature);
    const windSpeed = num(weather.windSpeed || weather.wind_speed);
    const carry = num(weather.carry || weather.carryScore || weather.hrCarry || weather.hrBoost || weather.hrBoostScore);

    if (roof.includes("DOME") || roof.includes("CLOSED")) {
      tags.push(["DOME", "tag-dome"]);
    }

    const windLabel = windOutLabel(weather);
    if (windSpeed >= 8 && windLabel) {
      tags.push([windLabel, "tag-wind tag-glow"]);
    }

    if (temp >= 80) {
      tags.push(["WARM AIR", "tag-warm tag-glow-soft"]);
    }

    if (carry >= 70) {
      tags.push(["CARRY BOOST", "tag-carry tag-glow"]);
    } else if (carry >= 60) {
      tags.push(["WEATHER EDGE", "tag-carry tag-glow-soft"]);
    }

    return tags;
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

    tags.push(...weatherTagsForRow(row));

    return tags.slice(0, 9);
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


  function normalizedLineupValue(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
  }

  function isLineupEligible(row) {
    return normalizedLineupValue(row?.lineupSource) !== "NOT_IN_LINEUP" &&
      normalizedLineupValue(row?.lineupStatus) !== "NOT_IN_LINEUP";
  }

  function allHitters(game) {
    return [...(game.hitters?.away || []), ...(game.hitters?.home || [])]
      .filter(isLineupEligible);
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
    if (pitcher && pitcher.vulnerability !== undefined && pitcher.vulnerability !== null) return num(pitcher.vulnerability);
    return null;
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
    for (const id of ["hero", "tabs", "games", "grid", "topVulnPanel", "marketTabs", "gameComparison"]) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }
    const sub = wrap.querySelector(".sub");
    sub.insertAdjacentHTML("afterend", `
      <section class="panel" id="topVulnPanel">
        <div class="panel-head"><div class="panel-title">Top Pitcher Risk <span id="avgVuln">Loading</span></div><div class="panel-note">0–100 index · click to jump</div></div>
        <div class="vulns" id="vulns"></div>
      </section>
      <div class="market-tabs" id="marketTabs">
        <button class="active" data-market="hr" type="button">Home Runs<small>Slate</small></button>
        <button data-market="hits" type="button">Hits<small>Board</small></button>
        <button data-market="tb" type="button">Total Bases<small>Board</small></button>
        <button data-market="rbis" type="button">RBIs<small>Board</small></button>
        <button data-market="pitcherKs" type="button">Pitcher Ks<small>Board</small></button>
      </div>
      <section class="hero" id="hero">Loading today’s live slate</section>
      <div class="tabs" id="tabs"></div>
      <section class="game-comparison" id="gameComparison" aria-live="polite"></section>
      <section class="games" id="games"></section>
    `);
  }


  function aiRows(limit = 5) {
    const players = state.aiSays?.players || {};
    return Object.values(players)
      .filter(row => row && row.player && row.summary)
      .sort((a, b) => num(b.score) - num(a.score))
      .slice(0, limit);
  }

  function aiOneLine(row) {
    const reasons = Array.isArray(row.reasons) ? row.reasons : [];
    const best = reasons.find(r => !String(r).toLowerCase().includes("confidence")) || reasons[0] || "Strong model profile";
    return `${best}.`;
  }

  function gradeClass(grade) {
    if (grade === "A+") return "aplus";
    if (grade === "A") return "a";
    if (grade === "B+") return "bplus";
    return "watch";
  }

  function renderAiSaysHome() {
    const box = document.getElementById("aiSaysPanel");
    if (!box) return;

    const rows = aiRows(5);
    if (!rows.length) {
      box.innerHTML = "";
      return;
    }

    const lock = rows[0];
    const rest = rows.slice(1);

    box.innerHTML = `
      <div class="ai-says-hero">
        <div class="ai-says-lock player-card" data-player-name="${esc(lock.player)}" data-player-id="${esc(lock.playerId || "")}">
          <div class="ai-kicker">🧠 AI SAYS</div>
          <div class="ai-lock-label">MODEL FAVORITE TODAY</div>
          <h2>${esc(lock.player)}</h2>
          <p>${esc(aiOneLine(lock))}</p>
          <div class="ai-lock-bottom">
            <span class="ai-grade ${gradeClass(lock.grade)}">${esc(lock.grade || "A")}</span>
            <small>${esc(lock.team || "")}${lock.opponent ? " vs " + esc(lock.opponent) : ""}</small>
          </div>
        </div>

        <div class="ai-says-list">
          ${rest.map(row => `
            <article class="ai-says-row player-card" data-player-name="${esc(row.player)}" data-player-id="${esc(row.playerId || "")}">
              <span class="ai-grade ${gradeClass(row.grade)}">${esc(row.grade || "A")}</span>
              <div>
                <b>${esc(row.player)}</b>
                <p>${esc(aiOneLine(row))}</p>
              </div>
            </article>
          `).join("")}
        </div>
      </div>
    `;
  }

  function modelExpectedSlateHRs() {
    let expected = 0;
    const seen = new Set();

    for (const game of state.games) {
      for (const side of ["away", "home"]) {
        const hitters = (game.hitters?.[side] || [])
          .filter(isLineupEligible)
          .sort((a, b) => lineupSpotOf(a) - lineupSpotOf(b) || num(scoreOf(b)) - num(scoreOf(a)))
          .slice(0, 9);

        for (const hitter of hitters) {
          const key = playerNameKey(hitter.player);
          if (!key || seen.has(key)) continue;
          const probability = state.probabilitiesByName.get(key);
          if (!Number.isFinite(probability)) continue;
          seen.add(key);
          expected += probability / 100;
        }
      }
    }

    return seen.size ? expected : null;
  }

  function renderTopVulnerabilities() {
    const rows = topPitcherRows();
    const highValue = rows.filter(row => row.score >= 45).length;
    const projectedHRs = modelExpectedSlateHRs();
    const avgPerGame = state.games.length && projectedHRs !== null ? projectedHRs / state.games.length : null;

    let environment = "LOW HR ENVIRONMENT";

    if (avgPerGame === null) {
      environment = "MODEL UPDATING";
    } else if (avgPerGame >= 3.05) {
      environment = "EXTREME HR ENVIRONMENT";
    } else if (avgPerGame >= 2.65) {
      environment = "HIGH HR ENVIRONMENT";
    } else if (avgPerGame >= 2.25) {
      environment = "ELEVATED HR ENVIRONMENT";
    } else if (avgPerGame >= 1.85) {
      environment = "AVERAGE HR ENVIRONMENT";
    }

    const avgVuln = document.getElementById("avgVuln");
    avgVuln.innerHTML = projectedHRs === null
      ? ` | <span class="vuln-env-tag">${esc(environment)}</span> • ${highValue} High Value Games`
      : ` | 🔥 <span class="vuln-proj-number" data-target="${projectedHRs.toFixed(1)}">0.0</span> Model Expected HR <span class="vuln-env-tag">${esc(environment)}</span> ${avgPerGame.toFixed(2)} HR/Game • ${highValue} High Value Games`;

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
    if (state.market !== "hr") {
      tabs.innerHTML = "";
      return;
    }
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
    const signals = slateSignalsFor(row);
    const signalClasses = signals.map(signal => signalClassName(signal.key)).join(" ");
    const signalIcons = signals.map(signal => `<span class="slate-signal-icon ${signalClassName(signal.key)}" title="${esc(signal.label)}" aria-label="${esc(signal.label)}">${esc(signal.emoji)}</span>`).join("");
    const signalLabels = signals.map(signal => `<span class="slate-signal-label ${signalClassName(signal.key)}"><span aria-hidden="true">${esc(signal.emoji)}</span>${esc(signal.label)}</span>`).join("");
    return `
      <article class="bat sweet-bat ${signalClasses}" data-player-id="${esc(row.playerId || "")}" data-player="${esc(row.player || "")}">
        <div class="face">${esc(initials(row.player))}</div>
        <div class="sweet-main">
          <div class="bat-name">#${esc(row.rank || index + 1)} ${esc(row.player)}${signalIcons ? `<span class="slate-signal-icons">${signalIcons}</span>` : ""}</div>
          ${signalLabels ? `<div class="slate-signal-labels">${signalLabels}</div>` : ""}
          <div class="sweet-lineup">${esc(lineupSpotLabel(row))}</div>
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
      .filter(isLineupEligible)
      .sort((a, b) => num(scoreOf(b)) - num(scoreOf(a)));
    const lineup = away ? game.homeBattingOrder || [] : game.awayBattingOrder || [];
    const lineupStatus = away ? game.homeLineupStatus : game.awayLineupStatus;
    const lineupText = lineup.length ? lineup.length + "/9" : (String(lineupStatus || "").includes("CONFIRMED") ? "Posted" : hitters.length ? "Projected" : "Pending");
    const pitcherLabel = pitcher?.name || pitcher?.pitcher || "TBD";
    const hand = pitcher?.side || pitcher?.throws || "";
    const vuln = pitcherVulnerability(game, side);
    const vulnClass = vulnerabilityTier(vuln).className;
    const pitcherStats = pitcherStatsFor(game, side);
    const pitcherId = String(pitcher?.id || pitcher?.playerId || "");
    const strikeoutRow = state.marketRows.pitcherKs.find(row =>
      String(row.pitcherId || row.playerId || "") === pitcherId || playerNameKey(row.pitcher || row.player) === playerNameKey(pitcherLabel)
    );
    const bullpenRows = state.bullpen.filter(row => String(row.team || "") === String(pitcherTeam || ""));
    const peakBullpen = bullpenRows.slice().sort((a, b) => num(b.hrRiskScore) - num(a.hrRiskScore))[0];
    const rate = key => Number.isFinite(Number(pitcherStats?.[key])) ? Number(pitcherStats[key]).toFixed(2) : "N/A";
    return `
      <article class="side ${vulnClass}">
        <div class="side-top"><div>
          <div class="pitcher">${esc(pitcherLabel)}</div>
          <div class="pitcher-sub">${esc(code(pitcherTeam))}${hand ? " • " + esc(hand) : ""} • vs ${esc(code(hitterTeam))}</div>
          <div class="mini"><div><label>Team</label><b>${esc(code(pitcherTeam))}</b></div><div><label>Bats</label><b>${hitters.length}</b></div><div><label>Lineup</label><b>${esc(lineupText)}</b></div><div><label>Risk</label><b>${whole(vuln)}</b></div></div>
        </div><div class="vbox"><b>${whole(vuln)}</b><span>RISK INDEX</span></div></div>
        <div class="pitcher-intel">
          <div><label>ERA</label><b>${esc(rate("era"))}</b></div><div><label>WHIP</label><b>${esc(rate("whip"))}</b></div>
          <div><label>K/9</label><b>${esc(rate("kPer9"))}</b></div><div><label>BB/9</label><b>${esc(rate("bbPer9"))}</b></div>
          <div><label>H/9</label><b>${esc(rate("hPer9"))}</b></div><div><label>HR/9</label><b>${esc(rate("hrPer9"))}</b></div>
          <div><label>Season HR</label><b>${esc(show(pitcherStats?.homeRuns))}</b></div><div><label>Projected K</label><b>${esc(strikeoutRow ? show(strikeoutRow.projectedStrikeouts) : "N/A")}</b></div>
        </div>
        ${peakBullpen ? `<div class="pitcher-context">Bullpen: <b>${esc(peakBullpen.tag || "Live")}</b> · peak reliever HR risk ${esc(whole(peakBullpen.hrRiskScore))}</div>` : ""}
        <div class="danger"><div class="danger-head"><span>Danger Batters</span><span>${hitters.length} bats</span></div><div class="bats">${hitters.slice(0, 8).map(renderBat).join("") || `<div class="empty">No hitter data yet for ${esc(hitterTeam)}</div>`}</div></div>
      </article>
    `;
  }

  function renderGame(game, index) {
    const key = gameKey(game);
    const selected = state.selectedGameKeys.has(key);
    return `
      <section class="game-card${selected ? " game-card-selected" : ""}" data-game="${index}" data-game-key="${esc(key)}">
        <div class="game-head"><div><h2>${esc(game.awayTeam)} at ${esc(game.homeTeam)}</h2><div class="game-meta">${esc(gameTime(game))}${game.venue ? " • " + esc(game.venue) : ""}${game.status ? " • " + esc(game.status) : ""}</div></div><div class="game-head-actions"><div class="pill ${lineupStatusLabel(game).toLowerCase()}">${esc(lineupStatusLabel(game))}</div><button class="game-select-button" type="button" data-select-game="${esc(key)}" aria-pressed="${selected}">${selected ? "Selected ✓" : "Compare game"}</button></div></div>
        <div class="matchup-grid">${renderSide(game, "away")}${renderSide(game, "home")}</div>
        ${renderWeather(weatherForVenue(game.venue))}
      </section>
    `;
  }

  function comparisonTarget(target) {
    const probability = probabilityForRow(target.row);
    const signals = slateSignalsFor(target.row);
    return `<div class="comparison-target-row">
      <div><strong>${esc(target.row.player)}</strong><span>${esc(target.row.team)} · vs ${esc(target.row.opposingPitcher || target.row.opposingProbablePitcher || "pitcher updating")}</span></div>
      <div class="comparison-target-metrics"><b>${esc(whole(target.score))}<small>MODEL</small></b><b>${probability === null ? "Updating" : esc(probability.toFixed(1) + "%")}<small>HR PROB.</small></b></div>
      ${signals.length ? `<div class="comparison-target-signals">${signals.map(signal => `<span title="${esc(signal.label)}"><i aria-hidden="true">${esc(signal.emoji)}</i>${esc(signal.label)}</span>`).join("")}</div>` : ""}
    </div>`;
  }

  function comparisonGameCard(snapshot, leaderKeys) {
    const { game, risk, topHitter, bullpen, key } = snapshot;
    const targets = topTargetsForGame(game);
    const leaderBadges = leaderKeys.get(key) || [];

    return `
      <article class="comparison-game-card">
        <div class="comparison-game-head">
          <div><span>${esc(gameTime(game) || "Time updating")}</span><h3>${esc(code(game.awayTeam))} at ${esc(code(game.homeTeam))}</h3></div>
          <button type="button" data-remove-game="${esc(key)}" aria-label="Remove ${esc(game.awayTeam)} at ${esc(game.homeTeam)} from comparison">Remove</button>
        </div>
        ${leaderBadges.length ? `<div class="comparison-leader-badges">${leaderBadges.map(label => `<span>${esc(label)}</span>`).join("")}</div>` : ""}
        <div class="comparison-signal-grid">
          <div><span>Highest pitcher risk</span><strong>${risk ? `${esc(risk.pitcher || "Pitcher")} · ${esc(whole(risk.score))}` : "Updating"}</strong></div>
          <div><span>Top hitter score</span><strong>${topHitter ? `${esc(topHitter.row.player)} · ${esc(whole(topHitter.score))}` : "Updating"}</strong></div>
          <div><span>Lineups</span><strong>${esc(lineupStatusLabel(game))}</strong></div>
          <div><span>Weather</span><strong>${esc(comparisonWeather(game))}</strong></div>
          <div><span>Peak bullpen HR risk</span><strong>${bullpen ? `${esc(bullpen.row.team)} · ${esc(whole(bullpen.score))}` : "Updating"}</strong></div>
        </div>
        <div class="comparison-targets"><span>Top live targets</span>${targets.length ? targets.map(comparisonTarget).join("") : "<b>Updating</b>"}</div>
      </article>
    `;
  }

  function comparisonLeaderStrip(leaders) {
    if (!leaders.length) return "";
    return `<section class="comparison-leaders" aria-label="Selected game category leaders">
      ${leaders.map(entry => `<article><span>${esc(entry.label)}</span><strong>${esc(code(entry.item.snapshot.game.awayTeam))} at ${esc(code(entry.item.snapshot.game.homeTeam))}</strong><b>${esc(entry.value(entry.item))}</b></article>`).join("")}
    </section>`;
  }

  function comparisonTable(snapshots) {
    const cell = value => value === null || value === undefined || value === "" ? "Updating" : value;
    return `<div class="comparison-table-wrap"><table class="comparison-table">
      <caption>Direct comparison of existing live Slate signals</caption>
      <thead><tr><th scope="col">Game</th><th scope="col">Lineups</th><th scope="col">Pitcher risk</th><th scope="col">Top hitter</th><th scope="col">HR probability</th><th scope="col">HR environment</th><th scope="col">Bullpen risk</th></tr></thead>
      <tbody>${snapshots.map(snapshot => `<tr>
        <th scope="row">${esc(code(snapshot.game.awayTeam))} at ${esc(code(snapshot.game.homeTeam))}<small>${esc(gameTime(snapshot.game) || "Time updating")}</small></th>
        <td>${esc(snapshot.lineup)}</td>
        <td>${snapshot.risk ? `${esc(whole(snapshot.risk.score))}<small>${esc(snapshot.risk.pitcher || "")}</small>` : "Updating"}</td>
        <td>${snapshot.topHitter ? `${esc(snapshot.topHitter.row.player)}<small>Score ${esc(whole(snapshot.topHitter.score))}</small>` : "Updating"}</td>
        <td>${snapshot.topProbability ? `${esc(snapshot.topProbability.score.toFixed(1))}%<small>${esc(snapshot.topProbability.row.player)}</small>` : "Updating"}</td>
        <td>${esc(cell(snapshot.weatherEnvironment === null ? null : whole(snapshot.weatherEnvironment)))}</td>
        <td>${snapshot.bullpen ? `${esc(whole(snapshot.bullpen.score))}<small>${esc(snapshot.bullpen.row.team)}</small>` : "Updating"}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;
  }

  function renderGameComparison() {
    const host = document.getElementById("gameComparison");
    if (!host) return;
    const selected = selectedGames();
    const count = selected.length;
    const snapshots = selected.map(gameComparisonSnapshot);
    const leaders = comparisonLeaders(snapshots);
    const leaderKeys = new Map();
    leaders.forEach(entry => {
      const key = entry.item.snapshot.key;
      if (!leaderKeys.has(key)) leaderKeys.set(key, []);
      leaderKeys.get(key).push(entry.label);
    });

    host.innerHTML = `
      <div class="comparison-tray-head">
        <div><span class="comparison-kicker">GAME COMPARISON</span><h2>Select up to five games</h2><p>Compare the live pitcher, hitter, lineup, weather and bullpen signals already on the Slate.</p></div>
        <div class="comparison-tray-actions"><strong>${count} / 5 selected</strong>${count ? `<button type="button" data-clear-games>Clear</button>` : ""}</div>
      </div>
      ${state.selectionMessage ? `<div class="comparison-message">${esc(state.selectionMessage)}</div>` : ""}
      ${count ? `<div class="comparison-picks">${selected.map(game => `<button type="button" data-focus-game="${esc(gameKey(game))}">${esc(code(game.awayTeam))} at ${esc(code(game.homeTeam))}</button>`).join("")}</div>` : `<div class="comparison-empty">Use <b>Compare game</b> on any matchup card to build a focused slate.</div>`}
      ${count ? `<button class="comparison-analyze-button" type="button" data-analyze-games aria-expanded="${state.comparisonOpen}">${state.comparisonOpen ? "Hide consolidated analysis" : `Analyze ${count} selected game${count === 1 ? "" : "s"}`}</button>` : ""}
      ${count && state.comparisonOpen ? `<div class="comparison-analysis"><div class="comparison-analysis-intro"><b>Five-game comparison analyzer</b><span>No composite score is created. Category leaders and every value below come directly from the current production Slate.</span></div>${comparisonLeaderStrip(leaders)}${comparisonTable(snapshots)}<div class="comparison-analysis-grid">${snapshots.map(snapshot => comparisonGameCard(snapshot, leaderKeys)).join("")}</div></div>` : ""}
    `;
    wireGameComparison();
  }

  function toggleGameSelection(key) {
    if (state.selectedGameKeys.has(key)) {
      state.selectedGameKeys.delete(key);
      state.selectionMessage = "Game removed from comparison.";
    } else if (state.selectedGameKeys.size >= 5) {
      state.selectionMessage = "The comparison is limited to five games. Remove one before adding another.";
    } else {
      state.selectedGameKeys.add(key);
      state.selectionMessage = "Game added to comparison.";
    }
    if (!state.selectedGameKeys.size) state.comparisonOpen = false;
    saveGameComparison();
    render();
  }

  function wireGameComparison() {
    document.querySelectorAll("[data-select-game]").forEach(button => {
      button.addEventListener("click", () => toggleGameSelection(button.dataset.selectGame));
    });
    document.querySelectorAll("[data-remove-game]").forEach(button => {
      button.addEventListener("click", () => toggleGameSelection(button.dataset.removeGame));
    });
    document.querySelector("[data-clear-games]")?.addEventListener("click", () => {
      state.selectedGameKeys.clear();
      state.comparisonOpen = false;
      state.selectionMessage = "Comparison cleared.";
      saveGameComparison();
      render();
    });
    document.querySelector("[data-analyze-games]")?.addEventListener("click", () => {
      state.comparisonOpen = !state.comparisonOpen;
      state.selectionMessage = "";
      render();
      if (state.comparisonOpen) document.querySelector(".comparison-analysis")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.querySelectorAll("[data-focus-game]").forEach(button => {
      button.addEventListener("click", () => document.querySelector(`[data-game-key="${CSS.escape(button.dataset.focusGame)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    });
  }

  function renderWeather(weather) {
    if (!weather) return "";
    return `<div class="weather"><b>Weather</b><span>${esc(weather.temp)}°F</span><span>${esc(weather.windSpeed)} mph ${esc(weather.windCompass)}</span><span>${esc(weather.humidity)}% humidity</span><span>${esc(weather.status || "live")}</span></div>`;
  }

  function marketLabel() {
    if (state.market === "hits") return "Hits";
    if (state.market === "tb") return "Total Bases";
    if (state.market === "rbis") return "RBIs";
    if (state.market === "pitcherKs") return "Pitcher Ks";
    return "Home Runs";
  }

  function wireMarketTabs() {
    document.querySelectorAll("#marketTabs button").forEach(button => {
      button.classList.toggle("active", button.dataset.market === state.market);
      button.classList.remove("disabled");
      button.addEventListener("click", () => {
        state.market = button.dataset.market || "hr";
        state.active = "all";
        state.filters = { search: "", team: "all", minProjection: 0, minScore: 0 };
        render();
      });
    });
  }

  function marketStat(row) {
    const hitter = row?.stats?.hitter || row?.hitterStats || {};
    const pitcher = row?.stats?.pitcher || row?.pitcherStats || {};

    if (state.market === "hits") {
      return { label: "Projected Hits", value: row.projectedHits ?? row.marketStatValue ?? row.projection ?? "N/A", seasonLabel: "Season Hits", seasonValue: hitter.hits ?? row.seasonTotal ?? "N/A" };
    }

    if (state.market === "tb") {
      return { label: "Projected TB", value: row.projectedTotalBases ?? row.marketStatValue ?? row.projection ?? "N/A", seasonLabel: "Season TB", seasonValue: hitter.totalBases ?? row.seasonTotal ?? "N/A" };
    }

    if (state.market === "rbis") {
      return { label: "Projected RBI", value: row.projectedRBIs ?? row.marketStatValue ?? row.projection ?? "N/A", seasonLabel: "Season RBI", seasonValue: hitter.rbi ?? row.seasonTotal ?? "N/A" };
    }

    if (state.market === "pitcherKs") {
      return { label: "Projected Ks", value: row.projectedStrikeouts ?? row.marketStatValue ?? row.projection ?? "N/A", seasonLabel: "Season SO", seasonValue: pitcher.strikeOuts ?? row.seasonTotal ?? "N/A" };
    }

    return { label: "Score", value: scoreOf(row) };
  }

  function renderMarketCard(row, index) {
    const s = statsOf(row);
    const score = scoreOf(row);
    const stat = marketStat(row);
    const note = row.note || (Array.isArray(row.reasons) ? row.reasons.join(" + ") : "market model target");
    const opponent = row.opponent || "";
    const game = row.game || "";
    const team = row.team || "";
    return `
      <article class="bat sweet-bat market-player-card" data-player-id="${esc(row.playerId || "")}" data-player="${esc(row.player || "")}">
        <div class="face">${esc(initials(row.player))}</div>
        <div class="sweet-main">
          <div class="bat-name">#${esc(row.rank || index + 1)} ${esc(row.player)}</div>
          <div class="sweet-lineup">${esc(team)}${opponent ? " vs " + esc(opponent) : ""}</div>
          <div class="tags">
            <span class="tag green">${esc(row.edge || "Target")}</span>
            <span class="tag gold">${esc(stat.label)}: ${esc(stat.value)}</span>
            ${stat.seasonLabel ? `<span class="tag teal">${esc(stat.seasonLabel)}: ${esc(stat.seasonValue)}</span>` : ""}
            <span class="tag">Score: ${esc(score)}</span>
            ${game ? `<span class="tag">${esc(game)}</span>` : ""}
          </div>
          <div class="sweet-note">${esc(note)}</div>
          ${statGrid(row)}
        </div>
        <div class="score sweet-score"><b>${esc(stat.value)}</b><br/>${esc(stat.label)}<br/><span>Score ${esc(score)}</span></div>
      </article>
    `;
  }

  function marketKey() {
    return state.market === "tb" ? "tb" : state.market === "rbis" ? "rbis" : state.market === "pitcherKs" ? "pitcherKs" : "hits";
  }

  function projectionValue(row) {
    const stat = marketStat(row);
    return num(stat.value);
  }

  function marketTeams(rows) {
    return [...new Set(rows.map(row => row.team).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b)));
  }

  function renderMarketFilters(allRows) {
    const teams = marketTeams(allRows);
    return `
      <div class="market-filter-panel">
        <input id="marketSearch" type="search" placeholder="Search player, pitcher, team, opponent..." value="${esc(state.filters.search)}" />
        <select id="marketTeam">
          <option value="all">All Teams</option>
          ${teams.map(team => `<option value="${esc(team)}" ${state.filters.team === team ? "selected" : ""}>${esc(team)}</option>`).join("")}
        </select>
        <select id="marketMinProjection">
          <option value="0" ${Number(state.filters.minProjection) === 0 ? "selected" : ""}>Any Projection</option>
          <option value="1" ${Number(state.filters.minProjection) === 1 ? "selected" : ""}>Projection 1.0+</option>
          <option value="2" ${Number(state.filters.minProjection) === 2 ? "selected" : ""}>Projection 2.0+</option>
          <option value="3" ${Number(state.filters.minProjection) === 3 ? "selected" : ""}>Projection 3.0+</option>
          <option value="5" ${Number(state.filters.minProjection) === 5 ? "selected" : ""}>Projection 5.0+</option>
        </select>
        <select id="marketMinScore">
          <option value="0" ${Number(state.filters.minScore) === 0 ? "selected" : ""}>Any Score</option>
          <option value="60" ${Number(state.filters.minScore) === 60 ? "selected" : ""}>Score 60+</option>
          <option value="68" ${Number(state.filters.minScore) === 68 ? "selected" : ""}>Score 68+</option>
          <option value="76" ${Number(state.filters.minScore) === 76 ? "selected" : ""}>Score 76+</option>
        </select>
        <button id="marketClearFilters" type="button">Clear</button>
      </div>
    `;
  }

  function filterMarketRows(rows) {
    const q = String(state.filters.search || "").toLowerCase().trim();
    const team = state.filters.team || "all";
    const minProjection = num(state.filters.minProjection);
    const minScore = num(state.filters.minScore);

    return rows.filter(row => {
      const haystack = [
        row.player,
        row.pitcher,
        row.team,
        row.opponent,
        row.game,
        row.edge,
        row.note
      ].join(" ").toLowerCase();

      if (q && !haystack.includes(q)) return false;
      if (team !== "all" && row.team !== team) return false;
      if (minProjection && projectionValue(row) < minProjection) return false;
      if (minScore && num(scoreOf(row)) < minScore) return false;

      return true;
    });
  }

  function wireMarketFilters() {
    const search = document.getElementById("marketSearch");
    const team = document.getElementById("marketTeam");
    const minProjection = document.getElementById("marketMinProjection");
    const minScore = document.getElementById("marketMinScore");
    const clear = document.getElementById("marketClearFilters");

    if (search) {
      search.addEventListener("input", () => {
        state.filters.search = search.value;
        render();
      });
    }

    if (team) {
      team.addEventListener("change", () => {
        state.filters.team = team.value;
        render();
      });
    }

    if (minProjection) {
      minProjection.addEventListener("change", () => {
        state.filters.minProjection = Number(minProjection.value || 0);
        render();
      });
    }

    if (minScore) {
      minScore.addEventListener("change", () => {
        state.filters.minScore = Number(minScore.value || 0);
        render();
      });
    }

    if (clear) {
      clear.addEventListener("click", () => {
        state.filters = { search: "", team: "all", minProjection: 0, minScore: 0 };
        render();
      });
    }
  }

  function renderMarketBoard() {
    const key = marketKey();
    const allRows = (state.marketRows[key] || []).slice().sort((a, b) => projectionValue(b) - projectionValue(a) || num(scoreOf(b)) - num(scoreOf(a)));
    const marketRows = filterMarketRows(allRows);

    document.getElementById("hero").innerHTML = `<b>${marketRows.length}</b> of ${allRows.length} ${esc(marketLabel())} targets shown`;
    document.getElementById("games").innerHTML = `
      <section class="game-card">
        <div class="game-head"><div><h2>Top ${esc(marketLabel())} Targets</h2><div class="game-meta">Filter by player, team, projection, or model score</div></div><div class="pill">BOARD</div></div>
        <div class="danger">
          ${renderMarketFilters(allRows)}
          <div class="bats">${marketRows.map(renderMarketCard).join("") || `<div class="empty">No ${esc(marketLabel())} targets match these filters.</div>`}</div>
        </div>
      </section>
    `;

    wireMarketFilters();
    wireCards();
  }

  function isVerifiedClosedSlate() {
    const scheduledGames = state.schedule?.games;
    return state.games.length === 0 &&
      state.health?.status === "healthy" &&
      state.health?.availability === "no_games_scheduled" &&
      Array.isArray(scheduledGames) &&
      scheduledGames.length === 0;
  }

  function slateDateLabel() {
    const raw = String(state.schedule?.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "Today";
    const date = new Date(`${raw}T12:00:00`);
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(date);
  }

  function slateUpdatedLabel() {
    const raw = state.health?.updatedAt || state.health?.generatedAt || state.schedule?.updatedAt;
    const date = new Date(raw || "");
    if (!Number.isFinite(date.getTime())) return "Current";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(date);
  }

  function renderClosedSlate() {
    document.body.classList.add("tsl-closed-slate");

    const topPanel = document.getElementById("topVulnPanel");
    if (topPanel) topPanel.style.display = "none";

    const hero = document.getElementById("hero");
    if (hero) hero.innerHTML = "";

    const tabs = document.getElementById("tabs");
    if (tabs) tabs.innerHTML = "";

    const comparison = document.getElementById("gameComparison");
    if (comparison) comparison.innerHTML = "";

    document.getElementById("games").innerHTML = `
      <section class="closed-slate-dashboard" aria-labelledby="closedSlateTitle">
        <div class="closed-slate-topline">
          <span class="closed-slate-kicker"><i aria-hidden="true"></i> MLB DATA CURRENT</span>
          <span class="closed-slate-date">${esc(slateDateLabel())}</span>
        </div>

        <div class="closed-slate-copy">
          <span class="closed-slate-label">TODAY'S SLATE</span>
          <h2 id="closedSlateTitle">No MLB games<br><em>scheduled today.</em></h2>
          <p>The board is intentionally closed. There is no live slate to model, so The Slip Lab is not showing stale matchups or recycled player recommendations.</p>
        </div>

        <div class="closed-slate-status" aria-label="Current slate status">
          <div><span>Scheduled games</span><strong>${esc(state.schedule?.gameCount ?? 0)}</strong></div>
          <div><span>Model state</span><strong>CLOSED</strong></div>
          <div><span>Data checked</span><strong>${esc(slateUpdatedLabel())}</strong></div>
          <div><span>Next refresh</span><strong>AUTOMATIC</strong></div>
        </div>

        <div class="closed-slate-actions">
          <a class="closed-slate-primary" href="./results.html">Review recent results <span aria-hidden="true">→</span></a>
          <a class="closed-slate-secondary" href="./lab-notes.html">Read Lab Notes</a>
        </div>

        <div class="closed-slate-footer">
          <span aria-hidden="true">●</span>
          The next board will populate automatically when MLB posts the next slate and probable pitchers.
        </div>
      </section>
    `;
  }

  function clearClosedSlate() {
    document.body.classList.remove("tsl-closed-slate");
    const topPanel = document.getElementById("topVulnPanel");
    if (topPanel) topPanel.style.display = "";
  }

  function render() {
    injectVulnerabilityStyles();
    wireMarketTabs();

    if (state.market === "hr" && isVerifiedClosedSlate()) {
      renderClosedSlate();
      return;
    }

    clearClosedSlate();

    if (state.market === "hr") {
      renderTopVulnerabilities();
      renderTabs();
      document.getElementById("hero").innerHTML = `<b>${state.games.length}</b> games loaded today from the daily matchup engine`;
      const visible = state.active === "all" ? state.games : state.games.filter((_, index) => String(index) === String(state.active));
      document.getElementById("games").innerHTML = visible.map(renderGame).join("") || '<div class="error">The current slate could not be verified. Live matchup cards are unavailable until the next successful refresh.</div>';
      renderGameComparison();
      wireCards();
      hydrateLast7();
      return;
    }

    const vuln = document.getElementById("topVulnPanel");
    if (vuln) vuln.style.display = "none";
    const aiPanel = document.getElementById("aiSaysPanel");
    if (aiPanel) aiPanel.style.display = "none";
    const comparison = document.getElementById("gameComparison");
    if (comparison) comparison.innerHTML = "";
    renderTabs();
    renderMarketBoard();
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

    document.getElementById("mSub").textContent =
      `${row.team || ""} vs ${row.opponent || ""}${row.opposingPitcher ? " • vs " + row.opposingPitcher : ""}`;

    document.getElementById("mMetrics").innerHTML = [
      ["HR", s.hr],
      ["AVG", dec(s.avg)],
      ["OBP", dec(s.obp)],
      ["SLG", dec(s.slg)],
      ["OPS", dec(s.ops)],
      ["RBI", s.rbi],
      ["Hits", s.hits],
      ["Score", scoreOf(row)]
    ].map(item =>
      `<div class="metric"><label>${esc(item[0])}</label><b>${esc(show(item[1]))}</b></div>`
    ).join("");

    const confidence = Math.round(num(row.hrConfidence || row.score || 0));
    const barrel = Math.round(num(row.barrelScore || 0));
    const hardHit = Math.round(num(row.hardHitScore || 0));
    const power = Math.round(num(row.truePowerScore || 0));
    const trend = Math.round(num(row.recentHRTrend || 0));
    const volatility = Math.round(num(row.hrVolatilityScore || 0));

    const pitcherStats = row?.stats?.pitcher || {};
    const pEra = num(pitcherStats.era || pitcherStats.ERA);
    const pWhip = num(pitcherStats.whip || pitcherStats.WHIP);
    const pHr = num(pitcherStats.homeRuns || pitcherStats.hr);
    const pIp = num(pitcherStats.inningsPitched || pitcherStats.ip);
    const pHr9 = pIp ? ((pHr / pIp) * 9) : 0;

    const weaknessNotes = [];

    if (pHr9 >= 1.25) weaknessNotes.push("Elevated HR allowance");
    if (pEra >= 4.50) weaknessNotes.push("Run prevention risk");
    if (pWhip >= 1.35) weaknessNotes.push("Traffic on bases");
    if (num(row.pitchPunishment) >= 8) weaknessNotes.push("Pitch type edge available");
    if (num(row.hotZoneAttack) >= 8) weaknessNotes.push("Attack zone overlap");
    if (!weaknessNotes.length) weaknessNotes.push("No major weakness flagged, rely on hitter power profile");

    document.getElementById("mContent").innerHTML = `
      <div class="section-title">Player Power Profile</div>

      <div class="metric-grid">
        <div class="metric"><label>Confidence</label><b>${confidence}</b></div>
        <div class="metric"><label>Power</label><b>${power}</b></div>
        <div class="metric"><label>Barrel</label><b>${barrel}</b></div>
        <div class="metric"><label>Hard Hit</label><b>${hardHit}</b></div>
        <div class="metric"><label>Trend</label><b>${trend}</b></div>
        <div class="metric"><label>Volatility</label><b>${volatility}</b></div>
      </div>

      <div class="section-title">Matchup Intelligence</div>

      <div class="player-stat-grid">
        <div class="player-stat"><label>Pitcher</label><b>${esc(row.opposingPitcher || "TBD")}</b></div>
        <div class="player-stat"><label>Venue</label><b>${esc(row.venue || "--")}</b></div>
        <div class="player-stat"><label>Tier</label><b>${esc(row.powerTier || "--")}</b></div>
        <div class="player-stat"><label>Edge</label><b>${esc(row.edge || "--")}</b></div>
        <div class="player-stat"><label>Bat Side</label><b>${esc(row.batSide || "--")}</b></div>
        <div class="player-stat"><label>Rank</label><b>#${esc(row.rank || "--")}</b></div>
      </div>

      <div class="section-title">Pitcher Weakness Summary</div>

      <div class="player-stat-grid">
        <div class="player-stat"><label>ERA</label><b>${pEra ? pEra.toFixed(2) : "--"}</b></div>
        <div class="player-stat"><label>WHIP</label><b>${pWhip ? pWhip.toFixed(2) : "--"}</b></div>
        <div class="player-stat"><label>HR Allowed</label><b>${pHr || "--"}</b></div>
        <div class="player-stat"><label>IP</label><b>${pIp || "--"}</b></div>
        <div class="player-stat"><label>HR/9</label><b>${pHr9 ? pHr9.toFixed(2) : "--"}</b></div>
        <div class="player-stat"><label>Risk</label><b>${weaknessNotes.length}</b></div>
      </div>

      <div class="sweet-why">Attack notes: ${weaknessNotes.map(esc).join(" • ")}</div>

      <div class="section-title">Model Notes</div>
      <div class="sweet-note">${esc(row.note || "No additional notes available.")}</div>

      ${row.why || row.matchupWhy
        ? `<div class="sweet-why">${esc(row.why || row.matchupWhy)}</div>`
        : ""
      }

      <div class="section-title">Spray Chart</div>

      ${spraySvg(row)}
    `;

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
.matchup-chip.tag-wind{background:rgba(0,180,255,.18);border-color:#36c8ff;color:#9ee8ff}.matchup-chip.tag-warm{background:rgba(255,120,30,.18);border-color:#ff8a00;color:#ffd0a0}
.matchup-chip.tag-carry{background:rgba(255,176,0,.22);border-color:#ffd15a;color:#ffe08a}
.matchup-chip.tag-dome{background:rgba(120,140,170,.16);border-color:#8da0ba;color:#dbe7f5}.matchup-chip.tag-due{background:rgba(255,0,90,.22);border-color:#ff3c80;color:#ffb0cc}
.matchup-chip.tag-breakout{background:rgba(255,210,80,.18);border-color:#ffd250;color:#ffe7a0}
.matchup-chip.tag-glow{box-shadow:0 0 10px currentColor,0 0 22px rgba(255,255,255,.18)}
.matchup-chip.tag-glow-soft{box-shadow:0 0 8px currentColor,0 0 16px rgba(255,255,255,.12)}
.sweet-lineup{display:inline-flex;width:max-content;margin:5px 0 2px;padding:3px 7px;border-radius:999px;background:rgba(140,255,50,.10);border:1px solid rgba(140,255,50,.25);color:#8cff32;font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:.05em}.sweet-note{color:#c8c8c8;font-size:12px;font-style:italic;margin-top:4px}.sweet-why{color:#ff6b2d;font-size:11px;font-weight:800;margin-top:4px}.sweet-l7{color:#00e0a4;font-size:11px;font-weight:850;margin-top:4px}.sweet-score{color:#fff}.player-stat{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:7px;padding:5px;text-align:center}.player-stat label{display:block;font-size:8px;color:#8fa09a;font-weight:950}.player-stat b{font-size:11px;color:#8cff32}.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:5000;justify-content:flex-end}.modal-bg.open{display:flex}.modal{width:min(620px,96vw);height:100vh;overflow:auto;background:#061010;border-left:1px solid rgba(140,255,50,.3);padding:18px}.modal-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}.modal-player{display:flex;gap:12px;align-items:center}.modal-face{width:54px;height:54px;border-radius:50%;background:#17272b;border:1px solid rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-weight:950}.modal h2{font-size:24px}.modal-sub{color:#9aaba4;font-size:13px;margin-top:4px}.close{background:#11191b;border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:10px;padding:9px 11px;font-weight:950;cursor:pointer}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;margin-bottom:12px}.metric{padding:11px;text-align:center;border-right:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06)}.metric label{display:block;color:#8fa09a;font-size:9px;font-weight:950;margin-bottom:5px}.metric b{color:#8cff32}.section-title{font-size:12px;letter-spacing:.14em;color:#8cff32;text-transform:uppercase;font-weight:950;margin:16px 0 10px}.spray svg{width:100%;height:310px;background:#071111;border:1px solid rgba(255,255,255,.07);border-radius:14px}

/* Editorial contrast ownership for dynamically rendered slate cards. */
body.tsl-editorial .panel{background:#fffdf7;border-color:#071d36;border-radius:0;color:#071d36}
body.tsl-editorial .panel-head{border-color:rgba(7,29,54,.22)}
body.tsl-editorial .panel-title,body.tsl-editorial .panel-note{color:#41566b}
body.tsl-editorial .panel-title span{color:#9b3219}
body.tsl-editorial .vuln{border-color:rgba(7,29,54,.18)}
body.tsl-editorial .vuln small{color:#075d4c}
body.tsl-editorial .vuln b,body.tsl-editorial .vuln:nth-child(n+2) b{color:#9b3219;filter:none}
body.tsl-editorial .vuln b::before{display:none}
body.tsl-editorial .vuln span,body.tsl-editorial .vuln:nth-child(n+2) span{border-color:#9b3219;color:#7a2d12}
body.tsl-editorial .vuln:nth-child(n+2) small{color:#704000}
body.tsl-editorial .vuln strong{color:#071d36}
body.tsl-editorial .vuln em{color:#41566b}
body.tsl-editorial .sweet-lineup{background:#e8f1ff;border-color:#1268f3;color:#084aab}
body.tsl-editorial .sweet-note{color:#31465a}
body.tsl-editorial .sweet-why{color:#8c2c16}
body.tsl-editorial .sweet-l7{color:#075d4c}
body.tsl-editorial .sweet-score{color:#071d36}
body.tsl-editorial .player-stat{background:#fffdf7;border-color:rgba(7,29,54,.2)}
body.tsl-editorial .player-stat label{color:#41566b}
body.tsl-editorial .player-stat b{color:#084aab}
body.tsl-editorial .matchup-chip{background:#f3f0e6;border-color:#506071;color:#071d36;box-shadow:none}
body.tsl-editorial .matchup-chip.level-elite,body.tsl-editorial .matchup-chip.level-high{background:#9b3219;border-color:#7b2512;color:#fff}
body.tsl-editorial .matchup-chip.level-mid{background:#f4d36a;border-color:#7a5700;color:#3f2b00}
body.tsl-editorial .matchup-chip.crusher,body.tsl-editorial .matchup-chip.tag-split{background:#efe5ff;border-color:#6b3fa0;color:#4a1f78}
body.tsl-editorial .matchup-chip.barrel,body.tsl-editorial .matchup-chip.tag-iso,body.tsl-editorial .matchup-chip.tag-barrel-king,body.tsl-editorial .matchup-chip.tag-cleanup,body.tsl-editorial .matchup-chip.tag-park,body.tsl-editorial .matchup-chip.tag-warm,body.tsl-editorial .matchup-chip.tag-carry,body.tsl-editorial .matchup-chip.tag-breakout{background:#fff0d4;border-color:#a65b00;color:#704000}
body.tsl-editorial .matchup-chip.hardhit,body.tsl-editorial .matchup-chip.tag-power,body.tsl-editorial .matchup-chip.tag-rbi,body.tsl-editorial .matchup-chip.tag-hot,body.tsl-editorial .matchup-chip.tag-hot-zone,body.tsl-editorial .matchup-chip.tag-leak,body.tsl-editorial .matchup-chip.tag-bullpen,body.tsl-editorial .matchup-chip.tag-due{background:#ffe7eb;border-color:#9d2941;color:#75182c}
body.tsl-editorial .matchup-chip.vs,body.tsl-editorial .matchup-chip.tag-top-order,body.tsl-editorial .matchup-chip.tag-wind,body.tsl-editorial .matchup-chip.tag-dome{background:#e8f1ff;border-color:#2866a8;color:#164776}
body.tsl-editorial .matchup-chip.recent,body.tsl-editorial .matchup-chip.tag-pitch-edge,body.tsl-editorial .matchup-chip.tag-pitcher-vuln{background:#ffeadf;border-color:#a23c17;color:#7a2d12}
body.tsl-editorial .matchup-chip.tag-speed,body.tsl-editorial .matchup-chip.tag-contact{background:#e1f5ed;border-color:#16745e;color:#075d4c}
body.tsl-editorial .matchup-chip.tag-glow,body.tsl-editorial .matchup-chip.tag-glow-soft{box-shadow:none}
.slate-signal-icons{display:inline-flex;align-items:center;gap:3px;margin-left:7px;vertical-align:middle}.slate-signal-icon{font-size:15px;line-height:1}.slate-signal-labels{display:flex;flex-wrap:wrap;gap:5px;margin:5px 0}.slate-signal-label{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(255,255,255,.07);color:#fff;font-size:9px;font-weight:950;text-transform:uppercase;letter-spacing:.04em}.slate-signal-label.signal-hot-look{border-color:#ff643c;background:rgba(255,82,42,.2);color:#ffc2b0}.slate-signal-label.signal-hot-lately{border-color:#9a68ff;background:rgba(120,70,255,.18);color:#d7c4ff}.slate-signal-label.signal-due{border-color:#ffc52a;background:rgba(255,197,42,.16);color:#ffe49a}.slate-signal-label.signal-sleeper{border-color:#00bfa5;background:rgba(0,191,165,.16);color:#8ff5e5}.sweet-bat.signal-hot-look{border-left-color:#ff5425;background:linear-gradient(110deg,rgba(170,45,18,.42),rgba(18,12,24,.9))}.sweet-bat.signal-hot-look:nth-child(even){border-left-color:#ff5425;background:linear-gradient(110deg,rgba(170,45,18,.42),rgba(18,12,24,.9))}
body.tsl-editorial .sweet-bat.signal-hot-look,body.tsl-editorial .sweet-bat.signal-hot-look:nth-child(even){border-left:6px solid #d84320;background:linear-gradient(105deg,#fff0e8 0,#fffdf7 48%)!important}.tsl-editorial .slate-signal-label{background:#f3f0e6;border-color:#506071;color:#071d36}.tsl-editorial .slate-signal-label.signal-hot-look{background:#ffe7df;border-color:#b63a1c;color:#7c2612}.tsl-editorial .slate-signal-label.signal-hot-lately{background:#eee7ff;border-color:#6d49a7;color:#452978}.tsl-editorial .slate-signal-label.signal-due{background:#fff1c7;border-color:#9a6b00;color:#684800}.tsl-editorial .slate-signal-label.signal-sleeper{background:#dcf5ef;border-color:#117461;color:#075447}

.game-head-actions{display:flex;align-items:flex-end;flex-direction:column;gap:8px}.game-select-button{appearance:none;min-width:118px;padding:8px 11px;border:1px solid rgba(140,255,50,.42);border-radius:9px;background:rgba(140,255,50,.08);color:#baff83;font-size:10px;font-weight:950;letter-spacing:.05em;text-transform:uppercase;cursor:pointer}.game-select-button:hover,.game-select-button[aria-pressed="true"]{background:#8cff32;border-color:#8cff32;color:#071007}.game-card-selected{border-color:#8cff32;box-shadow:0 0 0 1px rgba(140,255,50,.24),0 16px 40px rgba(0,0,0,.22)}
.game-comparison{margin:0 0 18px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:linear-gradient(135deg,rgba(16,31,32,.98),rgba(5,10,10,.98));overflow:hidden}.comparison-tray-head{display:flex;align-items:flex-start;justify-content:space-between;gap:22px;padding:18px}.comparison-kicker{display:block;margin-bottom:6px;color:#8cff32;font-size:9px;font-weight:950;letter-spacing:.2em}.comparison-tray-head h2{margin:0 0 5px;font-size:21px}.comparison-tray-head p{max-width:720px;margin:0;color:#9fb0aa;font-size:12px;line-height:1.5}.comparison-tray-actions{display:flex;align-items:center;gap:10px;white-space:nowrap}.comparison-tray-actions strong{color:#8cff32;font-size:12px}.comparison-tray-actions button,.comparison-game-head button{appearance:none;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:#11191b;color:#dce8e3;padding:7px 9px;font-size:10px;font-weight:900;cursor:pointer}.comparison-message{padding:9px 18px;border-top:1px solid rgba(255,255,255,.07);color:#ffd25a;font-size:11px;font-weight:850}.comparison-empty{padding:14px 18px;border-top:1px solid rgba(255,255,255,.07);color:#8d9c97;font-size:12px}.comparison-picks{display:flex;gap:8px;overflow:auto;padding:12px 18px;border-top:1px solid rgba(255,255,255,.07)}.comparison-picks button{appearance:none;white-space:nowrap;padding:8px 11px;border:1px solid rgba(0,224,164,.3);border-radius:999px;background:rgba(0,224,164,.08);color:#7fffe0;font-size:10px;font-weight:950;cursor:pointer}.comparison-analyze-button{appearance:none;width:calc(100% - 36px);margin:0 18px 18px;padding:12px 15px;border:1px solid #8cff32;border-radius:10px;background:#8cff32;color:#071007;font-size:11px;font-weight:950;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}.comparison-analysis{border-top:1px solid rgba(255,255,255,.09);padding:18px}.comparison-analysis-intro{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:14px}.comparison-analysis-intro b{font-size:14px;color:#fff}.comparison-analysis-intro span{max-width:620px;color:#8d9c97;font-size:11px;text-align:right}.comparison-analysis-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(275px,1fr));gap:10px}.comparison-game-card{min-width:0;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:#071010;padding:13px}.comparison-game-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:11px;border-bottom:1px solid rgba(255,255,255,.08)}.comparison-game-head span{color:#7f918b;font-size:9px;font-weight:900;text-transform:uppercase}.comparison-game-head h3{margin:3px 0 0;color:#fff;font-size:16px}.comparison-signal-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:10px}.comparison-signal-grid>div{min-width:0;padding:8px;border:1px solid rgba(255,255,255,.07);border-radius:7px;background:rgba(255,255,255,.025)}.comparison-signal-grid span,.comparison-targets>span{display:block;margin-bottom:4px;color:#758781;font-size:8px;font-weight:950;letter-spacing:.05em;text-transform:uppercase}.comparison-signal-grid strong{display:block;color:#eef8f3;font-size:11px;line-height:1.35}.comparison-targets{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.comparison-targets>span{width:100%}.comparison-targets b{padding:5px 7px;border-radius:6px;background:rgba(140,255,50,.08);color:#dfffd0;font-size:9px}.comparison-targets em{color:#8cff32;font-style:normal}
body.tsl-editorial .game-comparison{border-color:#071d36;border-radius:0;background:#fffdf7;color:#071d36}body.tsl-editorial .comparison-kicker{color:#9b3219}body.tsl-editorial .comparison-tray-head p,body.tsl-editorial .comparison-empty{color:#41566b}body.tsl-editorial .comparison-tray-actions strong{color:#084aab}body.tsl-editorial .comparison-tray-actions button,body.tsl-editorial .comparison-game-head button{border-color:#506071;border-radius:0;background:#f3f0e6;color:#071d36}body.tsl-editorial .comparison-message{border-color:rgba(7,29,54,.18);background:#fff1c7;color:#684800}body.tsl-editorial .comparison-picks,body.tsl-editorial .comparison-empty,body.tsl-editorial .comparison-analysis{border-color:rgba(7,29,54,.18)}body.tsl-editorial .comparison-picks button{border-color:#1268f3;border-radius:0;background:#e8f1ff;color:#084aab}body.tsl-editorial .comparison-analyze-button{border-color:#1268f3;border-radius:0;background:#1268f3;color:#fff}body.tsl-editorial .comparison-analysis-intro b{color:#071d36}body.tsl-editorial .comparison-analysis-intro span{color:#41566b}body.tsl-editorial .comparison-game-card{border-color:#071d36;border-radius:0;background:#fffdf7}body.tsl-editorial .comparison-game-head{border-color:rgba(7,29,54,.18)}body.tsl-editorial .comparison-game-head span{color:#52667a}body.tsl-editorial .comparison-game-head h3{color:#071d36}body.tsl-editorial .comparison-signal-grid>div{border-color:rgba(7,29,54,.18);border-radius:0;background:#f8f5ec}body.tsl-editorial .comparison-signal-grid span,body.tsl-editorial .comparison-targets>span{color:#52667a}body.tsl-editorial .comparison-signal-grid strong{color:#071d36}body.tsl-editorial .comparison-targets b{border:1px solid #aeb7bd;border-radius:0;background:#f3f0e6;color:#071d36}body.tsl-editorial .comparison-targets em{color:#084aab}body.tsl-editorial .game-select-button{border-color:#1268f3;border-radius:0;background:#e8f1ff;color:#084aab}body.tsl-editorial .game-select-button:hover,body.tsl-editorial .game-select-button[aria-pressed="true"]{background:#1268f3;color:#fff}body.tsl-editorial .game-card-selected{border-color:#1268f3;box-shadow:inset 5px 0 0 #1268f3}
.comparison-leaders{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:14px}.comparison-leaders article{min-width:0;padding:10px;border:1px solid rgba(140,255,50,.2);border-radius:9px;background:rgba(140,255,50,.055)}.comparison-leaders span,.comparison-leaders strong,.comparison-leaders b{display:block}.comparison-leaders span{color:#8fa29b;font-size:8px;font-weight:950;letter-spacing:.08em;text-transform:uppercase}.comparison-leaders strong{margin-top:5px;color:#f4fff8;font-size:11px}.comparison-leaders b{margin-top:2px;color:#8cff32;font-size:12px}.comparison-table-wrap{margin-bottom:14px;overflow-x:auto;border:1px solid rgba(255,255,255,.1);border-radius:10px}.comparison-table{width:100%;min-width:850px;border-collapse:collapse;background:#071010;color:#eef8f3;font-size:10px}.comparison-table caption{padding:9px 11px;text-align:left;color:#93a59f;font-size:9px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.comparison-table th,.comparison-table td{padding:10px;border-top:1px solid rgba(255,255,255,.08);text-align:left;vertical-align:top}.comparison-table thead th{color:#8cff32;font-size:8px;letter-spacing:.08em;text-transform:uppercase}.comparison-table tbody th{color:#fff;font-size:11px}.comparison-table small{display:block;margin-top:3px;color:#81928d;font-size:8px;font-weight:750}.comparison-leader-badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.comparison-leader-badges span{padding:4px 6px;border:1px solid rgba(140,255,50,.3);border-radius:999px;background:rgba(140,255,50,.08);color:#baff86;font-size:7px;font-weight:950;letter-spacing:.04em;text-transform:uppercase}.comparison-targets{display:block}.comparison-target-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;margin-top:7px;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:7px;background:rgba(255,255,255,.025)}.comparison-target-row strong,.comparison-target-row span{display:block}.comparison-target-row strong{color:#eef8f3;font-size:10px}.comparison-target-row>div:first-child span{margin-top:2px;color:#80928c;font-size:8px;line-height:1.3}.comparison-target-metrics{display:flex;gap:5px}.comparison-target-metrics b{min-width:43px;padding:4px!important;text-align:center}.comparison-target-metrics small{display:block;margin-top:2px;color:#7f918b;font-size:6px}.comparison-target-signals{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:4px}.comparison-target-signals span{display:inline-flex;align-items:center;gap:3px;padding:3px 5px;border-radius:999px;background:rgba(255,255,255,.05);color:#b9c8c3;font-size:7px;font-weight:850}.comparison-target-signals i{font-style:normal}.tsl-editorial .comparison-leaders article{border-color:#aeb7bd;border-radius:0;background:#f3f0e6}.tsl-editorial .comparison-leaders span{color:#52667a}.tsl-editorial .comparison-leaders strong{color:#071d36}.tsl-editorial .comparison-leaders b{color:#084aab}.tsl-editorial .comparison-table-wrap{border-color:#071d36;border-radius:0}.tsl-editorial .comparison-table{background:#fffdf7;color:#071d36}.tsl-editorial .comparison-table caption{color:#52667a}.tsl-editorial .comparison-table th,.tsl-editorial .comparison-table td{border-color:rgba(7,29,54,.18)}.tsl-editorial .comparison-table thead th{background:#071d36;color:#fff}.tsl-editorial .comparison-table tbody th{color:#071d36}.tsl-editorial .comparison-table small{color:#52667a}.tsl-editorial .comparison-leader-badges span{border-color:#1268f3;border-radius:0;background:#e8f1ff;color:#084aab}.tsl-editorial .comparison-target-row{border-color:rgba(7,29,54,.18);border-radius:0;background:#f8f5ec}.tsl-editorial .comparison-target-row strong{color:#071d36}.tsl-editorial .comparison-target-row>div:first-child span,.tsl-editorial .comparison-target-metrics small{color:#52667a}.tsl-editorial .comparison-target-signals span{border:1px solid #c2c9cd;border-radius:0;background:#fffdf7;color:#071d36}

body.tsl-closed-slate{background:#050811!important}
body.tsl-closed-slate main.wrap{max-width:none!important;min-height:calc(100vh - 132px);padding:0 0 80px!important;background:radial-gradient(circle at 70% 12%,rgba(18,104,243,.12),transparent 33%),#050811!important;color:#f4f7fb!important}
body.tsl-closed-slate main.wrap>.report-line,body.tsl-closed-slate main.wrap>.eyebrow,body.tsl-closed-slate main.wrap>h1,body.tsl-closed-slate main.wrap>.sub,body.tsl-closed-slate #topVulnPanel,body.tsl-closed-slate #marketTabs,body.tsl-closed-slate #hero,body.tsl-closed-slate #tabs{display:none!important}
body.tsl-closed-slate #games{display:block;max-width:1500px;margin:0 auto;padding:52px 24px 0}
.closed-slate-dashboard{position:relative;overflow:hidden;min-height:610px;border:1px solid rgba(125,156,199,.18);background:linear-gradient(145deg,rgba(10,18,34,.97),rgba(5,8,17,.99));box-shadow:0 30px 90px rgba(0,0,0,.32);padding:30px}
.closed-slate-dashboard:before{content:"";position:absolute;inset:0;background:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);background-size:44px 44px;mask-image:linear-gradient(to bottom,black,transparent 72%);pointer-events:none}
.closed-slate-dashboard:after{content:"SLATE";position:absolute;right:-20px;bottom:-58px;color:rgba(255,255,255,.025);font-size:210px;font-weight:1000;line-height:1;letter-spacing:-.08em;pointer-events:none}
.closed-slate-topline,.closed-slate-copy,.closed-slate-status,.closed-slate-actions,.closed-slate-footer{position:relative;z-index:1}
.closed-slate-topline{display:flex;align-items:center;justify-content:space-between;gap:18px;padding-bottom:24px;border-bottom:1px solid rgba(125,156,199,.16)}
.closed-slate-kicker,.closed-slate-date,.closed-slate-label{font-family:Inter,Arial,sans-serif;font-size:10px;font-weight:950;letter-spacing:.18em;text-transform:uppercase}
.closed-slate-kicker{display:inline-flex;align-items:center;gap:9px;color:#dce8f7}
.closed-slate-kicker i{width:8px;height:8px;border-radius:50%;background:#58f28b;box-shadow:0 0 18px rgba(88,242,139,.72)}
.closed-slate-date{color:#7f91aa}
.closed-slate-copy{max-width:900px;padding:74px 0 54px}
.closed-slate-label{display:block;margin-bottom:16px;color:#ff5a30}
.closed-slate-copy h2{margin:0;color:#f7f9fc;font-family:Georgia,"Times New Roman",serif;font-size:clamp(54px,7.2vw,104px);line-height:.88;letter-spacing:-.055em}
.closed-slate-copy h2 em{color:#2b78ff;font-weight:500}
.closed-slate-copy p{max-width:730px;margin:30px 0 0;color:#aab7c8;font-size:16px;line-height:1.65}
.closed-slate-status{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid rgba(125,156,199,.18);border-bottom:1px solid rgba(125,156,199,.18)}
.closed-slate-status>div{min-height:108px;padding:24px;border-right:1px solid rgba(125,156,199,.18)}
.closed-slate-status>div:last-child{border-right:0}
.closed-slate-status span{display:block;margin-bottom:14px;color:#70829a;font-size:9px;font-weight:950;letter-spacing:.14em;text-transform:uppercase}
.closed-slate-status strong{color:#f2f6fc;font-size:18px;letter-spacing:.02em}
.closed-slate-actions{display:flex;gap:12px;align-items:center;padding:28px 0}
.closed-slate-actions a{display:inline-flex;align-items:center;justify-content:center;gap:18px;min-height:48px;padding:0 18px;border:1px solid rgba(125,156,199,.24);font-size:11px;font-weight:950;letter-spacing:.08em;text-transform:uppercase}
.closed-slate-primary{background:#1268f3;color:#fff!important;border-color:#1268f3!important}
.closed-slate-primary:hover{background:#2879f5}
.closed-slate-secondary{background:rgba(255,255,255,.025);color:#dce8f7!important}
.closed-slate-footer{display:flex;align-items:center;gap:10px;color:#7f91aa;font-size:12px}
.closed-slate-footer span{color:#58f28b;font-size:9px}
@media(max-width:760px){body.tsl-closed-slate #games{padding:24px 14px 0}.closed-slate-dashboard{min-height:0;padding:20px}.closed-slate-topline{align-items:flex-start;flex-direction:column}.closed-slate-copy{padding:52px 0 42px}.closed-slate-copy h2{font-size:clamp(46px,15vw,72px)}.closed-slate-copy p{font-size:14px}.closed-slate-status{grid-template-columns:1fr 1fr}.closed-slate-status>div:nth-child(2){border-right:0}.closed-slate-status>div:nth-child(-n+2){border-bottom:1px solid rgba(125,156,199,.18)}.closed-slate-actions{align-items:stretch;flex-direction:column}.closed-slate-actions a{width:100%}.closed-slate-dashboard:after{font-size:100px}}

@media(max-width:1050px){.vulns{grid-template-columns:repeat(2,1fr)}.player-stat-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:700px){.comparison-tray-head,.comparison-analysis-intro{flex-direction:column}.comparison-tray-actions{width:100%;justify-content:space-between}.comparison-analysis-intro span{text-align:left}.comparison-signal-grid{grid-template-columns:1fr}.game-head-actions{width:100%;align-items:stretch}.game-select-button{width:100%}}
@media(max-width:600px){body.tsl-editorial .panel-head{align-items:flex-start;flex-direction:column;gap:8px}body.tsl-editorial .panel-note{line-height:1.4}.vulns{grid-template-columns:repeat(2,minmax(0,1fr))}.vuln{padding:15px 13px}}`;
    document.head.appendChild(style);
  }


/* AI Says Homepage Styles */
(function(){
  const style = document.createElement("style");
  style.textContent = `
    .ai-says-panel{margin:14px 0 18px!important}
    .ai-says-hero{display:grid!important;grid-template-columns:1.05fr 1.4fr!important;gap:14px!important}
    .ai-says-lock,.ai-says-row{cursor:pointer!important}
    .ai-says-lock{
      position:relative!important;overflow:hidden!important;border:1px solid rgba(140,255,50,.30)!important;
      border-radius:24px!important;padding:18px!important;
      background:radial-gradient(circle at 20% 0%,rgba(140,255,50,.22),transparent 34%),linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.025))!important;
      box-shadow:0 0 34px rgba(140,255,50,.16)!important;
    }
    .ai-says-lock:before,.ai-says-row:before{
      content:"";position:absolute;inset:-2px;
      background:linear-gradient(110deg,transparent,rgba(140,255,50,.18),rgba(255,176,0,.16),transparent);
      transform:translateX(-75%);animation:aiSweep 5.5s ease-in-out infinite;pointer-events:none;
    }
    @keyframes aiSweep{0%,70%{transform:translateX(-75%);opacity:0}82%{opacity:.8}100%{transform:translateX(75%);opacity:0}}
    .ai-kicker{color:#8cff32!important;font-weight:1000!important;letter-spacing:.16em!important;font-size:12px!important}
    .ai-lock-label{display:inline-flex!important;margin-top:10px!important;padding:5px 9px!important;border-radius:999px!important;background:rgba(255,176,0,.12)!important;border:1px solid rgba(255,176,0,.28)!important;color:#ffb000!important;font-size:10px!important;font-weight:1000!important}
    .ai-says-lock h2{margin:12px 0 6px!important;font-size:34px!important;line-height:1!important;color:#fff!important}
    .ai-says-lock p,.ai-says-row p{margin:0!important;color:#dfe8ef!important;font-size:13px!important;line-height:1.35!important;font-weight:800!important}
    .ai-lock-bottom{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;margin-top:16px!important}
    .ai-lock-bottom small{color:#9fb0ad!important;font-weight:900!important}
    .ai-says-list{display:grid!important;grid-template-columns:repeat(2,1fr)!important;gap:10px!important}
    .ai-says-row{
      position:relative!important;overflow:hidden!important;display:grid!important;grid-template-columns:54px 1fr!important;gap:10px!important;align-items:center!important;
      border:1px solid rgba(255,255,255,.10)!important;border-radius:18px!important;padding:12px!important;background:rgba(255,255,255,.045)!important;
    }
    .ai-says-row b{display:block!important;color:#fff!important;font-size:15px!important;margin-bottom:4px!important}
    .ai-grade{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-width:44px!important;height:34px!important;border-radius:12px!important;font-weight:1000!important;font-size:14px!important}
    .ai-grade.aplus{background:rgba(140,255,50,.16)!important;border:1px solid rgba(140,255,50,.42)!important;color:#8cff32!important;box-shadow:0 0 18px rgba(140,255,50,.18)!important}
    .ai-grade.a{background:rgba(255,176,0,.15)!important;border:1px solid rgba(255,176,0,.38)!important;color:#ffb000!important;box-shadow:0 0 18px rgba(255,176,0,.15)!important}
    .ai-grade.bplus{background:rgba(255,107,45,.15)!important;border:1px solid rgba(255,107,45,.36)!important;color:#ff8a45!important;box-shadow:0 0 18px rgba(255,107,45,.13)!important}
    @media(max-width:900px){.ai-says-hero{grid-template-columns:1fr!important}.ai-says-list{grid-template-columns:1fr!important}.ai-says-lock h2{font-size:28px!important}}
  `;
  document.head.appendChild(style);
})();


  async function load() {
    injectStyles();
    injectShell();
    restoreGameComparison();
    indexPlayerCards(await json("./data/player_card_data.json", { players: [] }));
    state.schedule = await json("./data/mlb_games_today.json", null);
    state.health = await json("./data/health_status.json", null);
    state.games = sortGamesByFirstPitch(await json("./data/game_pitcher_matchups.json", null));
    const currentGameKeys = new Set(state.games.map(gameKey));
    state.selectedGameKeys = new Set([...state.selectedGameKeys].filter(key => currentGameKeys.has(key)));
    saveGameComparison();
    state.marketRows.hits = rows(await json("./data/mlb_hits.json", []));
    state.marketRows.tb = rows(await json("./data/mlb_total_bases.json", []));
    state.marketRows.rbis = rows(await json("./data/mlb_rbis.json", []));
    state.marketRows.pitcherKs = rows(await json("./data/mlb_pitcher_strikeouts.json", []));
    state.bullpen = rows(await json("./data/bullpen_relievers.json", []));
    const probabilityPayload = await json("./data/hr_probability_tracking.json", { players: [] });
    state.probabilitiesByName = new Map(rows(probabilityPayload).map(row => [playerNameKey(row.player), Number(row.realHrProbability)]));
    const weatherPayload = await json("./data/mlb_weather.json", []);
    state.weather = Array.isArray(weatherPayload) ? weatherPayload : weatherPayload.weather || weatherPayload.rows || weatherPayload.data || [];
    state.spray = await json("./data/player_spray_charts.json", {});
    render();
  }

  load();
})();
