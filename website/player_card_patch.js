(() => {
  let PLAYERS = [];
  let SPRAY = {};
  let ZONES = {};
  let activePlayer = null;
  const l7Cache = {};

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[c]));

  const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const dec = v => Number.isFinite(Number(v)) ? Number(v).toFixed(3).replace(/^0/, "") : "N/A";
  const one = v => Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "N/A";
  const key = v => String(v || "").toLowerCase().trim();

  async function getJSON(path, fallback) {
    try {
      const res = await fetch(path + "?v=" + Date.now());
      return res.ok ? await res.json() : fallback;
    } catch {
      return fallback;
    }
  }

  function arr(x) {
    return Array.isArray(x) ? x : (x?.allPlayers || x?.players || x?.rows || x?.data || []);
  }

  function stats(row) {
    const h = row?.hitterStats || row?.stats?.hitter || row?.stats || {};
    return {
      HR: h.hr ?? row.hr ?? row.homeRuns,
      AVG: h.avg ?? row.avg,
      OBP: h.obp ?? row.obp,
      SLG: h.slg ?? row.slg,
      OPS: h.ops ?? row.ops,
      RBI: h.rbi ?? row.rbi,
      Hits: h.hits ?? row.hits
    };
  }

  function metric(label, value) {
    return `<div class="pcm"><label>${esc(label)}</label><b>${esc(value ?? "N/A")}</b></div>`;
  }

  function zoneFor(row) {
    return ZONES?.players?.[String(row.playerId || "")] || ZONES?.players?.[row.player] || ZONES?.players?.[key(row.player)] || null;
  }

  function enrich(row) {
    const z = zoneFor(row);
    if (!z?.zones) return row;

    const hot = (z.zones.slg || []).filter(v => num(v) >= .500).length;

    return {
      ...row,
      avgZones: z.zones.avg || row.avgZones,
      isoZones: z.zones.iso || row.isoZones,
      slgZones: z.zones.slg || row.slgZones,
      hrZones: z.zones.hr || row.hrZones,
      zoneCells: (z.zones.raw || []).map((c, i) => ({
        pitcher: 0,
        overlap: num(z.zones.slg?.[i] || 0) >= .500 ? 1 : 0,
        value: num(z.zones.slg?.[i] || 0)
      })),
      hitterZonePower: row.hitterZonePower || Math.max(...(z.zones.slg || [0])) * 100,
      hotZoneCount: row.hotZoneCount || hot,
      zoneOverlap: row.zoneOverlap || hot,
      pitcherLeak: row.pitcherLeak || 0
    };
  }

  function findPlayer(name, id) {
    const found = PLAYERS.find(x => id && String(x.playerId || "") === String(id)) || PLAYERS.find(x => key(x.player) === key(name));
    return found ? enrich(found) : null;
  }

  function zones(title, values, field, mode) {
    const cells = Array.isArray(values) ? values.slice(0, 25) : Array.from({ length: 25 }, () => 0);

    return `<div class="pcz"><h4>${esc(title)}</h4><div>${cells.map(cell => {
      const raw = field ? cell?.[field] : cell;
      const score = mode === "dec" ? num(raw) * 100 : mode === "cnt" ? num(raw) * 25 : num(raw) * 100;
      const cls = score >= 80 ? "z5" : score >= 60 ? "z4" : score >= 40 ? "z3" : score >= 20 ? "z2" : "z1";
      const txt = mode === "dec" ? dec(raw) : String(Math.round(num(raw)));
      return `<span class="${cls}">${txt}</span>`;
    }).join("")}</div></div>`;
  }

  function sprayChart(row) {
    const s = SPRAY?.byPlayerId?.[String(row.playerId || "")] || SPRAY?.players?.[row.player];
    const pts = s?.points || [];

    return `<svg class="pcs" viewBox="0 0 360 300">
      <path d="M180 280 L55 110 Q180 35 305 110 Z" fill="rgba(147,255,45,.08)" stroke="rgba(147,255,45,.4)"/>
      <path d="M180 280 L180 55 M180 280 L95 120 M180 280 L265 120" stroke="rgba(255,255,255,.18)"/>
      ${pts.slice(-180).map(p => `<circle cx="${Math.max(20, Math.min(340, num(p.x) * 1.2))}" cy="${Math.max(20, Math.min(280, num(p.y) * 1.15))}" r="${p.type === "hr" ? 5 : 3}" fill="${p.type === "hr" ? "#ff6374" : p.type === "xbh" ? "#ffd25a" : p.type === "hit" ? "#00e0a4" : "#6eb7ff"}"/>`).join("")}
    </svg>`;
  }

  function whyText(row) {
    const h = stats(row);
    const bits = [];

    if (num(h.SLG) >= .500) bits.push(`Strong power profile with ${dec(h.SLG)} SLG`);
    else if (num(h.SLG) >= .430) bits.push(`Playable power profile with ${dec(h.SLG)} SLG`);

    if (num(h.OPS) >= .800) bits.push(`${dec(h.OPS)} OPS gives him a real run producing ceiling`);
    if (num(h.HR) > 0) bits.push(`${h.HR} HR on the season keeps him live`);
    if (row.opposingPitcher) bits.push(`Matchup is against ${row.opposingPitcher}`);
    if (num(row.hitterZonePower) > 0) bits.push(`Zone power grades at ${one(row.hitterZonePower)}`);
    if (num(row.weather) > 0) bits.push(`Weather carry adds ${one(row.weather)}`);

    return bits.length ? bits.join(". ") + "." : "Matchup breakdown is building because this player is missing matchup detail fields.";
  }

  async function fetchL7(row) {
    const id = String(row.playerId || "");
    if (!id) return null;
    if (id in l7Cache) return l7Cache[id];

    const season = new Date().getFullYear();
    const url = `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&group=hitting&season=${season}`;

    try {
      const data = await (await fetch(url)).json();
      const games = (data?.stats?.[0]?.splits || []).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 7);

      let hr = 0, hits = 0, ab = 0, bb = 0, hbp = 0, sf = 0, tb = 0, k = 0;
      for (const g of games) {
        const s = g.stat || {};
        hr += num(s.homeRuns);
        hits += num(s.hits);
        ab += num(s.atBats);
        bb += num(s.baseOnBalls);
        hbp += num(s.hitByPitch);
        sf += num(s.sacFlies);
        tb += num(s.totalBases);
        k += num(s.strikeOuts);
      }

      const avg = ab ? hits / ab : 0;
      const obpDen = ab + bb + hbp + sf;
      const obp = obpDen ? (hits + bb + hbp) / obpDen : 0;
      const slg = ab ? tb / ab : 0;
      const ops = obp + slg;

      l7Cache[id] = { games, hr, avg, slg, ops, k };
      return l7Cache[id];
    } catch {
      l7Cache[id] = null;
      return null;
    }
  }

  function tabButton(name, id) {
    return `<button class="pctab" data-tab="${id}" type="button">${esc(name)}</button>`;
  }

  function renderTabShell(row) {
    return `
      <div class="pctabs">
        ${tabButton("Zones", "zones")}
        ${tabButton("Pitches", "pitches")}
        ${tabButton("Spot", "spot")}
        ${tabButton("Splits", "splits")}
        ${tabButton("Hist", "hist")}
        ${tabButton("Spray", "spray")}
        ${tabButton("Stats", "stats")}
        ${tabButton("L7G", "l7g")}
        ${tabButton("BP", "bp")}
      </div>
      <div id="pcTabBody"></div>
    `;
  }

  function renderTab(id, row) {
    const body = document.getElementById("pcTabBody");
    if (!body) return;

    document.querySelectorAll(".pctab").forEach(btn => btn.classList.toggle("on", btn.dataset.tab === id));

    const h = stats(row);

    if (id === "zones") {
      body.innerHTML = `<div class="pczones">${zones("AVG", row.avgZones, null, "dec")}${zones("ISO", row.isoZones, null, "dec")}${zones("SLG", row.slgZones, null, "dec")}${zones("HR", row.hrZones, null, "cnt")}${zones("Pitcher Leak", row.zoneCells, "pitcher")}${zones("Zone Overlap", row.zoneCells, "overlap")}</div>`;
      return;
    }

    if (id === "spray") {
      body.innerHTML = `<h3>Real Statcast Spray Chart</h3>${sprayChart(row)}`;
      return;
    }

    if (id === "stats") {
      body.innerHTML = `<h3>Hitter Stats</h3><div class="pcgrid">${Object.entries(h).map(([k, v]) => metric(k, ["AVG", "OBP", "SLG", "OPS"].includes(k) ? dec(v) : v)).join("")}</div>`;
      return;
    }

    if (id === "spot") {
      body.innerHTML = `<h3>Why It Matters</h3><p class="pcwhy">${esc(whyText(row))}</p>`;
      return;
    }

    if (id === "splits") {
      body.innerHTML = `<h3>Splits</h3><div class="pcgrid">${metric("Bat Side", row.batSide || row.bats)}${metric("Pitcher", row.opposingPitcher)}${metric("Pitch Hand", row.opposingPitcherHand || row.pitcherHand)}${metric("Score", one(row.hrConfidence ?? row.score))}</div>`;
      return;
    }

    if (id === "hist") {
      body.innerHTML = `<h3>History</h3><div class="pcgrid">${metric("Season HR", h.HR)}${metric("Season SLG", dec(h.SLG))}${metric("Season OPS", dec(h.OPS))}${metric("RBI", h.RBI)}</div>`;
      return;
    }

    if (id === "pitches") {
      body.innerHTML = `<h3>Pitch Matchup</h3><div class="pcgrid">${metric("Best Pitch", row.bestPitch)}${metric("Pitch Edge", one(row.pitchEdge))}${metric("Pitcher Risk", one(row.pitcherRisk))}${metric("Zone Overlap", one(row.zoneOverlap))}</div>`;
      return;
    }

    if (id === "bp") {
      body.innerHTML = `<h3>Bullpen and Late Game</h3><div class="pcgrid">${metric("Bullpen Risk", one(row.bullpen))}${metric("Due Score", one(row.due))}${metric("Tier", row.tier || row.edge)}${metric("Weather Carry", one(row.weather))}</div>`;
      return;
    }

    if (id === "l7g") {
      body.innerHTML = `<h3>Last 7 Games</h3><div class="pcwhy">Loading MLB game log...</div>`;
      fetchL7(row).then(l7 => {
        if (!l7) {
          body.innerHTML = `<h3>Last 7 Games</h3><div class="pcwhy">Last 7 game log unavailable for this player.</div>`;
          return;
        }

        body.innerHTML = `
          <h3>Last 7 Games</h3>
          <div class="pcgrid">${metric("Games", l7.games.length)}${metric("HR", l7.hr)}${metric("AVG", dec(l7.avg))}${metric("SLG", dec(l7.slg))}${metric("OPS", dec(l7.ops))}${metric("K", l7.k)}</div>
          <div class="pctable">
            <div>Date</div><div>AB</div><div>H</div><div>HR</div><div>RBI</div>
            ${l7.games.map(g => `<div>${esc(g.date || "")}</div><div>${esc(g.stat?.atBats ?? 0)}</div><div>${esc(g.stat?.hits ?? 0)}</div><div>${esc(g.stat?.homeRuns ?? 0)}</div><div>${esc(g.stat?.rbi ?? 0)}</div>`).join("")}
          </div>
        `;
      });
    }
  }

  function open(row) {
    activePlayer = enrich(row);
    const h = stats(activePlayer);

    let modal = document.getElementById("pcFull");
    if (!modal) {
      document.body.insertAdjacentHTML("beforeend", `<div id="pcFull"><div id="pcBox"></div></div>`);
      modal = document.getElementById("pcFull");
      modal.onclick = event => {
        if (event.target.id === "pcFull") modal.classList.remove("on");
      };
    }

    document.getElementById("pcBox").innerHTML = `
      <button id="pcClose">Close</button>
      <h2>${esc(activePlayer.player)}</h2>
      <p>${esc(activePlayer.team)} vs ${esc(activePlayer.opponent)}${activePlayer.opposingPitcher ? " • vs " + esc(activePlayer.opposingPitcher) : ""}</p>
      <h3>Model Card</h3>
      <div class="pcgrid">
        ${metric("HR Confidence", one(activePlayer.hrConfidence ?? activePlayer.score))}
        ${metric("Power", one(activePlayer.powerScore))}
        ${metric("Pitch Edge", one(activePlayer.pitchEdge))}
        ${metric("Pitcher Risk", one(activePlayer.pitcherRisk))}
        ${metric("Weather Carry", one(activePlayer.weather))}
        ${metric("Bullpen Risk", one(activePlayer.bullpen))}
        ${metric("Due Score", one(activePlayer.due))}
        ${metric("Tier", activePlayer.tier || activePlayer.edge)}
      </div>
      ${renderTabShell(activePlayer)}
    `;

    document.getElementById("pcClose").onclick = () => modal.classList.remove("on");

    document.querySelectorAll(".pctab").forEach(button => {
      button.addEventListener("click", () => renderTab(button.dataset.tab, activePlayer));
    });

    modal.classList.add("on");
    renderTab("zones", activePlayer);
  }

  function css() {
    if (document.getElementById("pcPatchCss")) return;

    const style = document.createElement("style");
    style.id = "pcPatchCss";
    style.textContent = `
      #pcFull{display:none;position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:999999;padding:18px;overflow:auto}
      #pcFull.on{display:block}
      #pcBox{max-width:920px;margin:auto;background:#090d12;border:1px solid rgba(147,255,45,.3);border-radius:12px;padding:10px;color:#f3f3f3}
      #pcBox h2{font-size:22px;line-height:1.05;margin:0}
      #pcBox p{font-size:12px;margin:4px 0 8px;color:#a8b0ba}
      #pcBox h3{font-size:13px;line-height:1;margin:12px 0 8px;text-transform:uppercase;letter-spacing:.08em}
      #pcClose{float:right;background:#111820;color:#fff;border:1px solid #333;border-radius:8px;padding:7px 10px;font-size:11px;font-weight:900;cursor:pointer}
      .pcgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
      .pcm{background:#0d1318;border:1px solid rgba(255,255,255,.08);border-radius:7px;padding:7px;min-height:42px}
      .pcm label{display:block;color:#8e98a3;font-size:8px;font-weight:900;text-transform:uppercase;line-height:1;margin-bottom:4px}
      .pcm b{font-size:13px;line-height:1;color:#93ff2d}
      .pctabs{display:flex;gap:6px;overflow:auto;background:#151a20;border-radius:10px;padding:7px;margin:12px 0}
      .pctab{background:transparent;color:#8e98a3;border:0;border-radius:9px;padding:10px 14px;font-size:15px;font-weight:900;cursor:pointer}
      .pctab.on{color:#fff;background:#080b0f;border:2px solid #ff7448}
      #pcTabBody{min-height:180px}
      .pczones{display:grid;grid-template-columns:repeat(3,max-content);gap:7px;align-items:start}
      .pcz{background:#0d1318;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:5px;width:max-content}
      .pcz h4{font-size:11px;line-height:1;margin:0 0 4px}
      .pcz div{display:grid;grid-template-columns:repeat(5,28px);gap:1px}
      .pcz span{width:28px;height:28px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;background:#141922}
      .z2{background:#183d34!important}.z3{background:#496315!important}.z4{background:#9a6b11!important}.z5{background:#ffb423!important}
      .pcs{width:100%;height:260px;background:#071111;border:1px solid rgba(255,255,255,.07);border-radius:10px}
      .pcwhy{background:#0d1318;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;line-height:1.45;color:#dce3ea}
      .pctable{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:#182026;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;margin-top:10px}
      .pctable div{background:#0d1318;padding:8px;font-size:12px}
      @media(max-width:850px){#pcBox{max-width:94vw}.pcgrid{grid-template-columns:repeat(2,1fr)}.pczones{grid-template-columns:repeat(2,max-content)}}
    `;
    document.head.appendChild(style);
  }

  async function boot() {
    css();

    const decision = await getJSON("./data/hr_decision_center.json", {});
    const homeRuns = await getJSON("./data/mlb_home_runs.json", []);
    ZONES = await getJSON("./data/statcast_zones.json", {});
    SPRAY = await getJSON("./data/player_spray_charts.json", {});

    const map = new Map();
    [...arr(decision), ...arr(homeRuns)].forEach(row => {
      if (row?.player) map.set(key(row.player), { ...(map.get(key(row.player)) || {}), ...row });
    });

    PLAYERS = [...map.values()];

    document.addEventListener("click", event => {
      const target = event.target.closest(".bat[data-player],tr[data-player],.player-card[data-player-name]");
      if (!target) return;

      const row = findPlayer(target.dataset.player || target.dataset.playerName, target.dataset.playerId);
      if (!row) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      open(row);
    }, true);
  }

  boot();
})();
