(() => {
  const state = {
    games: [],
    spray: {},
    active: "all"
  };

  const teamCode = {
    "Arizona Diamondbacks": "ARI",
    "Atlanta Braves": "ATL",
    "Baltimore Orioles": "BAL",
    "Boston Red Sox": "BOS",
    "Chicago Cubs": "CHC",
    "Chicago White Sox": "CWS",
    "Cincinnati Reds": "CIN",
    "Cleveland Guardians": "CLE",
    "Colorado Rockies": "COL",
    "Detroit Tigers": "DET",
    "Houston Astros": "HOU",
    "Kansas City Royals": "KC",
    "Los Angeles Angels": "LAA",
    "Los Angeles Dodgers": "LAD",
    "Miami Marlins": "MIA",
    "Milwaukee Brewers": "MIL",
    "Minnesota Twins": "MIN",
    "New York Mets": "NYM",
    "New York Yankees": "NYY",
    "Athletics": "ATH",
    "Oakland Athletics": "ATH",
    "Sacramento Athletics": "ATH",
    "Philadelphia Phillies": "PHI",
    "Pittsburgh Pirates": "PIT",
    "San Diego Padres": "SD",
    "San Francisco Giants": "SF",
    "Seattle Mariners": "SEA",
    "St. Louis Cardinals": "STL",
    "Tampa Bay Rays": "TB",
    "Texas Rangers": "TEX",
    "Toronto Blue Jays": "TOR",
    "Washington Nationals": "WSH"
  };

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function code(team) {
    return teamCode[team] || String(team || "").split(" ").map(part => part[0]).join("").slice(0, 3).toUpperCase();
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function fixed(value, digits = 3) {
    const parsed = number(value, null);
    if (parsed === null) return "N/A";
    return parsed.toFixed(digits).replace(/^0/, "");
  }

  function whole(value) {
    const parsed = number(value, null);
    return parsed === null ? "N/A" : String(Math.round(parsed));
  }

  function percent(value) {
    const parsed = number(value, null);
    if (parsed === null) return "N/A";
    return Math.round(parsed * 10) / 10 + "%";
  }

  function initials(value) {
    return String(value || "").split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase();
  }

  function rows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    return payload.matchups || payload.games || payload.players || payload.rows || payload.data || payload.allPlayers || [];
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

  function gameTime(game) {
    const date = new Date(game.gameDate || "");
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function hitterStats(row) {
    const hitter = row.stats?.hitter || row.hitterStats || row.stats || {};
    return {
      hr: hitter.hr ?? row.hr ?? row.homeRuns,
      avg: hitter.avg ?? row.avg,
      obp: hitter.obp ?? row.obp,
      slg: hitter.slg ?? row.slg,
      ops: hitter.ops ?? row.ops,
      rbi: hitter.rbi ?? row.rbi,
      hits: hitter.hits ?? row.hits,
      doubles: hitter.doubles ?? row.doubles,
      triples: hitter.triples ?? row.triples,
      strikeOuts: hitter.strikeOuts ?? row.strikeOuts
    };
  }

  function topScore(row) {
    if (!row) return "N/A";
    return row.score ?? row.hrConfidence ?? row.powerScore ?? "N/A";
  }

  function topNumber(row) {
    return number(row?.score ?? row?.hrConfidence ?? row?.powerScore ?? 0);
  }

  function allHitters(game) {
    return [...(game.hitters?.away || []), ...(game.hitters?.home || [])];
  }

  function topVulnerabilityScore(game) {
    return Math.max(...allHitters(game).map(topNumber), 0);
  }

  function pitcherName(game, side) {
    const pitcher = side === "away" ? game.awayPitcher : game.homePitcher;
    return pitcher?.name || pitcher?.pitcher || "TBD";
  }

  function injectBase() {
    const wrap = document.querySelector("main.wrap");
    if (!wrap) return;

    const oldHero = document.getElementById("hero");
    const oldTabs = document.getElementById("tabs");
    const oldGames = document.getElementById("games") || document.getElementById("grid");

    if (oldHero) oldHero.remove();
    if (oldTabs) oldTabs.remove();
    if (oldGames) oldGames.remove();

    let panel = document.getElementById("topVulnPanel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "topVulnPanel";
      panel.className = "panel";
      panel.innerHTML = '<div class="panel-head"><div class="panel-title">Top Vulnerabilities</div><div class="panel-note" id="avgVuln">Loading</div></div><div class="vulns" id="vulns"></div>';
      const sub = wrap.querySelector(".sub");
      sub.insertAdjacentElement("afterend", panel);
    }

    const hero = document.createElement("section");
    hero.className = "hero";
    hero.id = "hero";
    hero.textContent = "Loading today’s live slate";
    panel.insertAdjacentElement("afterend", hero);

    const tabs = document.createElement("div");
    tabs.className = "tabs";
    tabs.id = "tabs";
    hero.insertAdjacentElement("afterend", tabs);

    const games = document.createElement("section");
    games.className = "games";
    games.id = "games";
    tabs.insertAdjacentElement("afterend", games);
  }

  function renderTopVulnerabilities() {
    const sorted = [...state.games]
      .map(game => ({ game, score: topVulnerabilityScore(game) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const avg = sorted.length ? sorted.reduce((sum, item) => sum + item.score, 0) / sorted.length : 0;
    const avgNode = document.getElementById("avgVuln");
    const listNode = document.getElementById("vulns");
    if (avgNode) avgNode.textContent = avg.toFixed(1) + " avg top score";
    if (listNode) {
      listNode.innerHTML = sorted.map((item, index) => {
        const game = item.game;
        const top = allHitters(game).sort((a, b) => topNumber(b) - topNumber(a))[0] || {};
        return '<div class="vuln"><small>#' + (index + 1) + '</small><b>' + esc(Math.round(item.score)) + '</b><strong>' + esc(top.player || pitcherName(game, "home")) + '</strong><span>' + esc(code(game.awayTeam)) + ' at ' + esc(code(game.homeTeam)) + '</span></div>';
      }).join("");
    }
  }

  function renderTabs() {
    const tabs = document.getElementById("tabs");
    tabs.innerHTML = '<button class="' + (state.active === "all" ? "active" : "") + '" data-game="all">All Games<span>' + state.games.length + ' games</span></button>' + state.games.map((game, index) => {
      return '<button class="' + (String(state.active) === String(index) ? "active" : "") + '" data-game="' + index + '">' + esc(code(game.awayTeam)) + ' at ' + esc(code(game.homeTeam)) + '<span>' + esc(gameTime(game)) + '</span></button>';
    }).join("");

    tabs.querySelectorAll("button").forEach(button => {
      button.addEventListener("click", () => {
        state.active = button.dataset.game;
        render();
      });
    });
  }

  function playerStatGrid(row) {
    const stats = hitterStats(row);
    return '<div class="player-stat-grid">' +
      metric("HR", stats.hr) +
      metric("AVG", fixed(stats.avg)) +
      metric("OBP", fixed(stats.obp)) +
      metric("SLG", fixed(stats.slg)) +
      metric("OPS", fixed(stats.ops)) +
      metric("RBI", stats.rbi) +
      '</div>';
  }

  function metric(label, value) {
    return '<div class="player-stat"><label>' + esc(label) + '</label><b>' + esc(value ?? "N/A") + '</b></div>';
  }

  function renderBat(row, index) {
    const stats = hitterStats(row);
    const note = row.note || (Array.isArray(row.reasons) ? row.reasons.join(" + ") : "power plus matchup fit");
    return '<article class="bat" data-player-id="' + esc(row.playerId || "") + '" data-player="' + esc(row.player || "") + '">' +
      '<div class="face">' + esc(initials(row.player)) + '</div>' +
      '<div>' +
        '<div class="bat-name">#' + esc(row.rank || index + 1) + ' ' + esc(row.player) + '</div>' +
        '<div class="tags"><span class="tag green">' + esc(row.edge || row.tier || "Watch") + '</span>' +
        (row.batSide ? '<span class="tag teal">' + esc(row.batSide) + '</span>' : '') +
        (row.opposingPitcher ? '<span class="tag gold">vs ' + esc(row.opposingPitcher) + '</span>' : '') +
        '</div>' +
        playerStatGrid(row) +
        '<div class="why">' + esc(note) + '</div>' +
      '</div>' +
      '<div class="score"><b>' + esc(topScore(row)) + '</b><br/>score<br/><span>' + esc(fixed(stats.slg)) + ' SLG</span></div>' +
    '</article>';
  }

  function renderSide(game, side) {
    const away = side === "away";
    const team = away ? game.awayTeam : game.homeTeam;
    const opponent = away ? game.homeTeam : game.awayTeam;
    const pitcher = away ? game.awayPitcher : game.homePitcher;
    const hitters = away ? (game.hitters?.away || []) : (game.hitters?.home || []);
    const lineup = away ? (game.awayBattingOrder || []) : (game.homeBattingOrder || []);
    const top = hitters[0] || null;
    const pitcherLabel = pitcher?.name || pitcher?.pitcher || "TBD";
    const sideLabel = pitcher?.side || pitcher?.throws || "";

    return '<article class="side"><div class="side-top"><div><div class="pitcher">' + esc(pitcherLabel) + '</div><div class="pitcher-sub">' + esc(code(team)) + (sideLabel ? ' • ' + esc(sideLabel) : '') + ' • vs ' + esc(code(opponent)) + '</div><div class="mini"><div><label>Team</label><b>' + esc(code(team)) + '</b></div><div><label>Bats</label><b>' + hitters.length + '</b></div><div><label>Lineup</label><b>' + (lineup.length ? lineup.length + '/9' : 'Pending') + '</b></div><div><label>SP</label><b>' + esc(pitcherLabel) + '</b></div></div></div><div class="vbox"><b>' + esc(topScore(top)) + '</b><span>TOP BAT</span></div></div><div class="danger"><div class="danger-head"><span>Danger Batters</span><span>' + hitters.length + ' bats</span></div><div class="bats">' + (hitters.slice(0, 8).map(renderBat).join("") || '<div class="empty">No hitter data yet for ' + esc(team) + '</div>') + '</div></div></article>';
  }

  function renderGame(game, index) {
    return '<section class="game-card" data-game="' + index + '"><div class="game-head"><div><h2>' + esc(game.awayTeam) + ' at ' + esc(game.homeTeam) + '</h2><div class="game-meta">' + esc(gameTime(game)) + (game.venue ? ' • ' + esc(game.venue) : '') + (game.status ? ' • ' + esc(game.status) : '') + '</div></div><div class="pill">' + esc(game.lineupLockStatus || "Lineups Updating") + '</div></div><div class="matchup-grid">' + renderSide(game, "away") + renderSide(game, "home") + '</div>' + renderWeather(game.weather) + '</section>';
  }

  function renderWeather(weather) {
    if (!weather) return "";
    return '<div class="weather"><b>Weather</b><span>' + esc(weather.temp) + '°F</span><span>' + esc(weather.windSpeed) + ' mph ' + esc(weather.windCompass) + '</span><span>' + esc(weather.humidity) + '% humidity</span><span>' + esc(weather.status || "live") + '</span></div>';
  }

  function render() {
    injectBase();
    renderTopVulnerabilities();
    renderTabs();
    const visible = state.active === "all" ? state.games : state.games.filter((_, index) => String(index) === String(state.active));
    document.getElementById("hero").innerHTML = '<b>' + state.games.length + '</b> games loaded today from the daily matchup engine';
    document.getElementById("games").innerHTML = visible.map(renderGame).join("") || '<div class="error">No games loaded. Run the MLB refresh.</div>';
    wireCards();
  }

  function wireCards() {
    document.querySelectorAll(".bat").forEach(card => {
      card.addEventListener("click", () => {
        const playerId = card.dataset.playerId;
        const player = card.dataset.player;
        const hitter = state.games.flatMap(allHitters).find(row => String(row.playerId || "") === String(playerId || "") || row.player === player);
        if (hitter) openModal(hitter);
      });
    });
  }

  function sprayFor(row) {
    const byId = state.spray.byPlayerId || {};
    const byName = state.spray.players || {};
    return byId[String(row.playerId || "")] || byName[row.player] || null;
  }

  function spraySvg(row) {
    const chart = sprayFor(row);
    const points = chart?.points || [];
    const dots = points.slice(-180).map(point => {
      const x = Math.max(25, Math.min(335, number(point.x, 180) * 1.2));
      const y = Math.max(25, Math.min(285, number(point.y, 160) * 1.15));
      const color = point.type === "hr" ? "#ff6374" : point.type === "xbh" ? "#ffd25a" : point.type === "hit" ? "#00e0a4" : "#6eb7ff";
      const radius = point.type === "hr" ? 5 : 3;
      return '<circle cx="' + x + '" cy="' + y + '" r="' + radius + '" fill="' + color + '" opacity=".9"><title>' + esc(point.event || "batted ball") + '</title></circle>';
    }).join("");

    const summary = chart?.summary ? '<div class="section-title">Real Statcast Spray Chart • ' + esc(chart.summary.battedBalls) + ' batted balls • ' + esc(chart.summary.homeRuns) + ' HR</div>' : '<div class="section-title">Spray Chart</div><div class="empty">No Baseball Savant spray data built yet. Run node scripts/mlb/build_player_spray_charts.mjs</div>';

    return summary + '<div class="spray"><svg viewBox="0 0 360 310"><path d="M180 285 L55 115 Q180 35 305 115 Z" fill="rgba(140,255,50,.09)" stroke="rgba(140,255,50,.35)"/><path d="M180 285 L180 62 M180 285 L95 125 M180 285 L265 125" stroke="rgba(255,255,255,.18)"/><circle cx="180" cy="285" r="5" fill="#fff"/>' + dots + '</svg></div>';
  }

  function openModal(row) {
    ensureModal();
    const stats = hitterStats(row);
    document.getElementById("mFace").textContent = initials(row.player);
    document.getElementById("mName").textContent = row.player || "Player";
    document.getElementById("mSub").textContent = (row.team || "") + " vs " + (row.opponent || "") + (row.opposingPitcher ? " • vs " + row.opposingPitcher : "");
    document.getElementById("mMetrics").innerHTML = [
      ["HR", stats.hr], ["AVG", fixed(stats.avg)], ["OBP", fixed(stats.obp)], ["SLG", fixed(stats.slg)],
      ["OPS", fixed(stats.ops)], ["RBI", stats.rbi], ["Hits", stats.hits], ["Score", topScore(row)]
    ].map(item => '<div class="metric"><label>' + esc(item[0]) + '</label><b>' + esc(item[1] ?? "N/A") + '</b></div>').join("");
    document.getElementById("mContent").innerHTML = spraySvg(row);
    document.getElementById("modalBg").classList.add("open");
  }

  function ensureModal() {
    if (document.getElementById("modalBg")) return;
    const modal = document.createElement("div");
    modal.className = "modal-bg";
    modal.id = "modalBg";
    modal.innerHTML = '<aside class="modal"><div class="modal-head"><div class="modal-player"><div class="modal-face" id="mFace"></div><div><h2 id="mName"></h2><div class="modal-sub" id="mSub"></div></div></div><button class="close" id="mClose">Close</button></div><div class="metric-grid" id="mMetrics"></div><div id="mContent"></div></aside>';
    document.body.appendChild(modal);
    document.getElementById("mClose").onclick = () => modal.classList.remove("open");
    modal.onclick = event => {
      if (event.target.id === "modalBg") modal.classList.remove("open");
    };
  }

  function injectStyles() {
    if (document.getElementById("slateFullRendererStyles")) return;
    const style = document.createElement("style");
    style.id = "slateFullRendererStyles";
    style.textContent = ".panel{background:#081010;border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;margin-bottom:14px}.panel-head{display:flex;justify-content:space-between;padding:10px 13px;border-bottom:1px solid rgba(255,255,255,.07)}.panel-title{font-size:11px;letter-spacing:.16em;color:#a4b2ad;text-transform:uppercase;font-weight:950}.panel-note{color:#8cff32;font-weight:950;font-size:12px}.vulns{display:grid;grid-template-columns:repeat(5,1fr)}.vuln{padding:13px;border-right:1px solid rgba(255,255,255,.07)}.vuln b{display:block;color:#8cff32;font-size:24px;margin:2px 0}.vuln small{color:#00e0a4;font-weight:950}.vuln strong{display:block;font-size:14px}.vuln span{display:block;color:#94a39d;font-size:11px;margin-top:3px}.player-stat-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin:7px 0}.player-stat{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:7px;padding:5px;text-align:center}.player-stat label{display:block;font-size:8px;color:#8fa09a;font-weight:950}.player-stat b{font-size:11px;color:#8cff32}.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:5000;justify-content:flex-end}.modal-bg.open{display:flex}.modal{width:min(620px,96vw);height:100vh;overflow:auto;background:#061010;border-left:1px solid rgba(140,255,50,.3);padding:18px}.modal-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}.modal-player{display:flex;gap:12px;align-items:center}.modal-face{width:54px;height:54px;border-radius:50%;background:#17272b;border:1px solid rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-weight:950}.modal h2{font-size:24px}.modal-sub{color:#9aaba4;font-size:13px;margin-top:4px}.close{background:#11191b;border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:10px;padding:9px 11px;font-weight:950;cursor:pointer}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;margin-bottom:12px}.metric{padding:11px;text-align:center;border-right:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06)}.metric label{display:block;color:#8fa09a;font-size:9px;font-weight:950;margin-bottom:5px}.metric b{color:#8cff32}.section-title{font-size:12px;letter-spacing:.14em;color:#8cff32;text-transform:uppercase;font-weight:950;margin:16px 0 10px}.spray svg{width:100%;height:310px;background:#071111;border:1px solid rgba(255,255,255,.07);border-radius:14px}@media(max-width:1050px){.vulns{grid-template-columns:repeat(2,1fr)}.player-stat-grid{grid-template-columns:repeat(3,1fr)}}";
    document.head.appendChild(style);
  }

  async function load() {
    injectStyles();
    injectBase();
    const matchups = await json("./data/game_pitcher_matchups.json", null);
    state.games = rows(matchups);
    state.spray = await json("./data/player_spray_charts.json", {});
    render();
  }

  load();
})();
