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

  function gameTime(game) {
    const date = new Date(game.gameDate || "");
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
    return row?.score ?? row?.hrConfidence ?? row?.powerScore ?? "N/A";
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

  function matchupBadges(row) {
    const level = matchupLevel(row);
    const previous = previousHrVsPitcher(row);
    const hand = handMatchupLabel(row);

    return `
      <div class="matchup-badges">
        <span class="matchup-chip level-${level.toLowerCase()}">${esc(level)}</span>
        ${previous > 0 ? `<span class="matchup-chip crusher">CRUSHER</span>` : ""}
        <span class="matchup-chip barrel">${esc(barrelLabel(row))}</span>
        <span class="matchup-chip hardhit">${esc(hardHitLabel(row))}</span>
        ${hand ? `<span class="matchup-chip vs">${esc(hand)}</span>` : ""}
        ${recentLabel(row) ? `<span class="matchup-chip recent">${esc(recentLabel(row))}</span>` : ""}
      </div>
    `;
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

  function renderTopVulnerabilities() {
    const rows = topPitcherRows();
    const avg = rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
    const highValue = rows.filter(row => row.score >= 55).length;

    document.getElementById("avgVuln").textContent = ` | ${avg.toFixed(1)} proj HRs   ${highValue} high-value games`;

    document.getElementById("vulns").innerHTML = rows.length ? rows.map((row, index) => {
      const label = row.score >= 80 ? "TARGET" : row.score >= 55 ? "STRONG" : "WATCH";
      return `
        <button class="vuln" data-game="${state.games.indexOf(row.game)}" type="button">
          <div class="vuln-line">
            <small>#${index + 1}</small>
            <b>${Math.round(row.score)}</b>
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
    const hitters = away ? game.hitters?.home || [] : game.hitters?.away || [];
    const lineup = away ? game.homeBattingOrder || [] : game.awayBattingOrder || [];
    const lineupStatus = away ? game.homeLineupStatus : game.awayLineupStatus;
    const lineupText = lineup.length ? lineup.length + "/9" : (String(lineupStatus || "").includes("POSTED") ? "Posted" : hitters.length ? "Projected" : "Pending");
    const pitcherLabel = pitcher?.name || pitcher?.pitcher || "TBD";
    const hand = pitcher?.side || pitcher?.throws || "";
    const vuln = pitcherVulnerability(game, side);
    return `
      <article class="side">
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
        <div class="game-head"><div><h2>${esc(game.awayTeam)} at ${esc(game.homeTeam)}</h2><div class="game-meta">${esc(gameTime(game))}${game.venue ? " • " + esc(game.venue) : ""}${game.status ? " • " + esc(game.status) : ""}</div></div><div class="pill">${esc(game.lineupLockStatus || "Lineups Updating")}</div></div>
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
    style.textContent = `.panel{background:#090a10;border:1px solid rgba(255,255,255,.08);border-radius:6px;overflow:hidden;margin-bottom:22px}.panel-head{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;border-bottom:1px solid rgba(255,255,255,.07)}.panel-title{font-size:11px;letter-spacing:.32em;color:#9ba1ad;text-transform:uppercase;font-weight:950}.panel-title span{letter-spacing:0;text-transform:none;color:#ff6b2d;margin-left:12px;font-size:13px}.panel-note{color:#4c515c;font-weight:800;font-size:11px}.vulns{display:grid;grid-template-columns:repeat(5,1fr)}.vuln{appearance:none;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:18px 20px;border:0;border-right:1px solid rgba(255,255,255,.07)}.vuln-line{display:flex;align-items:center;gap:9px;margin-bottom:8px}.vuln small{color:#00e083;font-weight:950;font-size:12px}.vuln b{color:#ff4d63;font-size:23px;line-height:1;font-weight:950}.vuln span{border:1px solid #ff4d63;color:#ff4d63;border-radius:5px;padding:4px 7px;font-size:10px;font-weight:950;letter-spacing:.18em}.vuln:nth-child(n+2) b{color:#ff8a00}.vuln:nth-child(n+2) small{color:#ffc400}.vuln:nth-child(n+2) span{border-color:#ff8a00;color:#ff8a00}.vuln strong{display:block;font-size:15px;color:#f2f2f2;margin-bottom:5px}.vuln em{display:block;color:#555b66;font-style:normal;font-size:11px;font-weight:800}.player-stat-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin:7px 0}.sweet-bat{background:linear-gradient(110deg,rgba(130,70,20,.42),rgba(18,12,24,.88));border-left:3px solid #ffb000}.sweet-bat:nth-child(even){background:linear-gradient(110deg,rgba(65,18,96,.55),rgba(9,15,18,.9));border-left-color:#b36cff}.sweet-main{min-width:0}.matchup-badges{display:flex;flex-wrap:wrap;gap:5px;margin:5px 0 8px}.matchup-chip{border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 7px;font-size:10px;font-weight:950;line-height:1;color:#fff;background:rgba(255,255,255,.07)}.matchup-chip.level-elite{background:#ff6b00;border-color:#ff9a38;color:#fff}.matchup-chip.level-high{background:#ff7a00;border-color:#ffb15a;color:#fff}.matchup-chip.level-mid{background:#ffb000;border-color:#ffd15a;color:#130b00}.matchup-chip.crusher{background:#9c27b0;border-color:#e05cff;color:#fff}.matchup-chip.barrel{background:rgba(255,122,0,.18);border-color:#ff7a00;color:#ffb000}.matchup-chip.hardhit{background:rgba(255,60,80,.18);border-color:#ff3c50;color:#ff7c88}.matchup-chip.vs{background:rgba(20,35,50,.85);border-color:#5d7188;color:#b8c6d4}.matchup-chip.recent{background:rgba(255,122,0,.12);border-color:#b65a00;color:#ff9d18}.sweet-note{color:#c8c8c8;font-size:12px;font-style:italic;margin-top:4px}.sweet-why{color:#ff6b2d;font-size:11px;font-weight:800;margin-top:4px}.sweet-l7{color:#00e0a4;font-size:11px;font-weight:850;margin-top:4px}.sweet-score{color:#fff}.player-stat{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:7px;padding:5px;text-align:center}.player-stat label{display:block;font-size:8px;color:#8fa09a;font-weight:950}.player-stat b{font-size:11px;color:#8cff32}.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:5000;justify-content:flex-end}.modal-bg.open{display:flex}.modal{width:min(620px,96vw);height:100vh;overflow:auto;background:#061010;border-left:1px solid rgba(140,255,50,.3);padding:18px}.modal-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}.modal-player{display:flex;gap:12px;align-items:center}.modal-face{width:54px;height:54px;border-radius:50%;background:#17272b;border:1px solid rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-weight:950}.modal h2{font-size:24px}.modal-sub{color:#9aaba4;font-size:13px;margin-top:4px}.close{background:#11191b;border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:10px;padding:9px 11px;font-weight:950;cursor:pointer}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;margin-bottom:12px}.metric{padding:11px;text-align:center;border-right:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06)}.metric label{display:block;color:#8fa09a;font-size:9px;font-weight:950;margin-bottom:5px}.metric b{color:#8cff32}.section-title{font-size:12px;letter-spacing:.14em;color:#8cff32;text-transform:uppercase;font-weight:950;margin:16px 0 10px}.spray svg{width:100%;height:310px;background:#071111;border:1px solid rgba(255,255,255,.07);border-radius:14px}@media(max-width:1050px){.vulns{grid-template-columns:repeat(2,1fr)}.player-stat-grid{grid-template-columns:repeat(3,1fr)}}`;
    document.head.appendChild(style);
  }

  async function load() {
    injectStyles();
    injectShell();
    state.games = rows(await json("./data/game_pitcher_matchups.json", null));
    state.spray = await json("./data/player_spray_charts.json", {});
    render();
  }

  load();
})();
