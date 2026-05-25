(() => {
  let PLAYERS = [];
  let SPRAY = {};
  let ZONES = {};
  let CARD_DATA = {};
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
  const pct = v => Number.isFinite(Number(v)) ? Math.round(Number(v)) + "%" : "N/A";
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
      Hits: h.hits ?? row.hits,
      K: h.strikeOuts ?? row.strikeOuts,
      PA: h.plateAppearances ?? row.plateAppearances,
      AB: h.atBats ?? row.atBats
    };
  }

  function getVal(row, names, fallback = 0) {
    for (const name of names) {
      const parts = name.split(".");
      let cur = row;
      for (const part of parts) cur = cur?.[part];
      if (cur !== undefined && cur !== null && cur !== "") return cur;
    }
    return fallback;
  }

  function metric(label, value) {
    return `<div class="pcm"><label>${esc(label)}</label><b>${esc(value ?? "N/A")}</b></div>`;
  }

  function bar(label, value, max = 100, sub = "") {
    const n = Math.max(0, Math.min(100, max ? num(value) / max * 100 : num(value)));
    return `<div class="pcbar">
      <div class="pcbar-top"><span>${esc(label)}</span><b>${esc(one(value))}${sub}</b></div>
      <div class="pcbar-track"><div class="pcbar-fill" style="width:${n}%"></div></div>
    </div>`;
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
    if (!found) return null;

    const extra =
      CARD_DATA?.byId?.[String(found.playerId || "")] ||
      CARD_DATA?.byName?.[key(found.player)] ||
      {};

    return enrich({
      ...found,
      cardData: extra,
      last7: extra.last7 || found.last7,
      last15: extra.last15 || found.last15,
      gameLogs: extra.gameLogs || found.gameLogs,
      enrichedTags: extra.tags || found.enrichedTags,
      season: extra.season || found.season
    });
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
      ${pts.slice(-220).map(p => `<circle cx="${Math.max(20, Math.min(340, num(p.x) * 1.2))}" cy="${Math.max(20, Math.min(280, num(p.y) * 1.15))}" r="${p.type === "hr" ? 5 : 3}" fill="${p.type === "hr" ? "#ff6374" : p.type === "xbh" ? "#ffd25a" : p.type === "hit" ? "#00e0a4" : "#6eb7ff"}"/>`).join("")}
    </svg>`;
  }

  function grade(row) {
    const score = num(row.hrConfidence ?? row.score);
    const h = stats(row);
    if (score >= 55 || num(h.SLG) >= .550 || num(h.OPS) >= .900) return "ELITE";
    if (score >= 42 || num(h.SLG) >= .480 || num(h.OPS) >= .820) return "HIGH";
    if (score >= 28 || num(h.SLG) >= .430 || num(h.OPS) >= .760) return "MID";
    return "WATCH";
  }

  function chips(row) {
    const h = stats(row);
    const out = [grade(row)];

    if (num(h.HR) >= 10) out.push(`${h.HR} HR`);
    if (num(h.SLG) >= .500) out.push("POWER");
    if (num(h.OPS) >= .850) out.push("OPS");
    if (num(row.hotZoneCount) >= 4) out.push("HOT ZONES");
    if (num(row.hitterZonePower) >= 50) out.push("ZONE EDGE");
    if (num(row.weather) > 0) out.push("WEATHER");
    if (num(row.bullpen) > 0) out.push("BULLPEN");

    return out.slice(0, 8).map((x, i) => `<span class="pcchip c${i}">${esc(x)}</span>`).join("");
  }

  function whyText(row) {
    const h = stats(row);
    const bits = [];

    if (num(h.SLG) >= .500) bits.push(`Strong power profile with ${dec(h.SLG)} SLG`);
    else if (num(h.SLG) >= .430) bits.push(`Playable power profile with ${dec(h.SLG)} SLG`);

    if (num(h.OPS) >= .800) bits.push(`${dec(h.OPS)} OPS gives him real run producing ceiling`);
    if (num(h.HR) > 0) bits.push(`${h.HR} HR on the season keeps him live`);
    if (row.opposingPitcher) bits.push(`Matchup is against ${row.opposingPitcher}`);
    if (num(row.hitterZonePower) > 0) bits.push(`Zone power grades at ${one(row.hitterZonePower)}`);
    if (num(row.hotZoneCount) > 0) bits.push(`${row.hotZoneCount} hot zones show where his damage profile is strongest`);
    if (num(row.weather) > 0) bits.push(`Weather carry adds ${one(row.weather)} to the profile`);
    if (num(row.bullpen) > 0) bits.push(`Bullpen risk adds late game upside`);

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

      let hr = 0, hits = 0, ab = 0, bb = 0, hbp = 0, sf = 0, tb = 0, k = 0, rbi = 0;
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
        rbi += num(s.rbi);
      }

      const avg = ab ? hits / ab : 0;
      const obpDen = ab + bb + hbp + sf;
      const obp = obpDen ? (hits + bb + hbp) / obpDen : 0;
      const slg = ab ? tb / ab : 0;
      const ops = obp + slg;

      l7Cache[id] = { games, hr, avg, slg, ops, k, rbi, ab, hits };
      return l7Cache[id];
    } catch {
      l7Cache[id] = null;
      return null;
    }
  }

  function tabButton(name, id) {
    return `<button class="pctab" data-tab="${id}" type="button">${esc(name)}</button>`;
  }

  function renderTabShell() {
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

  function renderHero(row) {
    const h = stats(row);
    const conf = num(row.hrConfidence ?? row.score);
    const prob = Math.max(3, Math.min(25, conf / 4));

    return `
      <div class="pcheader">
        <div>
          <h2>${esc(row.player)}</h2>
          <p>${esc(row.team)} vs ${esc(row.opponent)}${row.opposingPitcher ? " • vs " + esc(row.opposingPitcher) : ""}</p>
          <div class="pcchips">${chips(row)}</div>
        </div>
        <div class="pcprob">
          <b>${one(prob)}%</b>
          <span>HR Chance</span>
        </div>
      </div>

      <div class="pcbiggrid">
        ${metric("ISO", dec(num(h.SLG) - num(h.AVG)))}
        ${metric("SLG", dec(h.SLG))}
        ${metric("HR", h.HR)}
        ${metric("OPS", dec(h.OPS))}
        ${metric("HR Confidence", one(conf))}
        ${metric("Power", one(row.powerScore))}
        ${metric("Pitch Edge", one(row.pitchEdge))}
        ${metric("Weather", one(row.weather))}
      </div>

      <div class="pcbars">
        ${bar("HR Confidence", conf, 100)}
        ${bar("Power Score", row.powerScore, 100)}
        ${bar("Zone Power", row.hitterZonePower, 100)}
        ${bar("Pitcher Risk", row.pitcherRisk, 100)}
      </div>
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
      body.innerHTML = `
        <h3>Percentile Style Profile</h3>
        <div class="pcprofile">
          ${bar("Season HR", h.HR, 40)}
          ${bar("SLG", num(h.SLG) * 100, 70)}
          ${bar("OPS", num(h.OPS) * 100, 110)}
          ${bar("Contact", num(h.AVG) * 100, 35)}
        </div>
        <div class="pcgrid">${Object.entries(h).map(([k, v]) => metric(k, ["AVG", "OBP", "SLG", "OPS"].includes(k) ? dec(v) : v)).join("")}</div>
      `;
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
      body.innerHTML = `<h3>History</h3><div class="pcgrid">${metric("Season HR", h.HR)}${metric("Season SLG", dec(h.SLG))}${metric("Season OPS", dec(h.OPS))}${metric("RBI", h.RBI)}${metric("Hits", h.Hits)}${metric("PA", h.PA)}</div>`;
      return;
    }

    if (id === "pitches") {
      body.innerHTML = `
        <h3>Pitch Matchup</h3>
        <div class="pcgrid">${metric("Best Pitch", row.bestPitch)}${metric("Pitch Edge", one(row.pitchEdge))}${metric("Pitcher Risk", one(row.pitcherRisk))}${metric("Zone Overlap", one(row.zoneOverlap))}${metric("Hitter Zone Power", one(row.hitterZonePower))}${metric("Hot Zones", row.hotZoneCount)}</div>
        <div class="pcwhy">${esc(row.bestPitch ? "Best pitch matchup is attached to this profile." : "Pitch mix detail is ready for connection when the pitch type file is available.")}</div>
      `;
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
          <div class="pcl7hero">
            <div><b>${l7.hr}</b><span>HR</span></div>
            <div><b>${dec(l7.avg)}</b><span>AVG</span></div>
            <div><b>${dec(l7.slg)}</b><span>SLG</span></div>
            <div><b>${dec(l7.ops)}</b><span>OPS</span></div>
            <div><b>${l7.rbi}</b><span>RBI</span></div>
          </div>
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
      ${renderHero(activePlayer)}
      ${renderTabShell()}
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
      #pcFull{display:none;position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:999999;padding:18px;overflow:auto}
      #pcFull.on{display:block}
      #pcBox{max-width:980px;margin:auto;background:radial-gradient(circle at 20% 0%,rgba(255,106,0,.22),transparent 34%),linear-gradient(180deg,#120b09,#070a0f 45%,#080d12);border:1px solid rgba(255,116,72,.35);border-radius:18px;padding:14px;color:#f3f3f3;box-shadow:0 0 42px rgba(255,106,0,.16)}
      #pcBox h2{font-size:28px;line-height:1.05;margin:0;color:#fff}
      #pcBox p{font-size:13px;margin:6px 0 10px;color:#b9c0ca}
      #pcBox h3{font-size:13px;line-height:1;margin:14px 0 10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2}
      #pcClose{float:right;background:#111820;color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:8px 11px;font-size:11px;font-weight:900;cursor:pointer}
      .pcheader{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:14px;border-radius:16px;background:linear-gradient(90deg,rgba(255,106,0,.22),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.08);margin-bottom:10px}
      .pcprob{width:110px;height:84px;border-radius:16px;border:1px solid rgba(255,116,72,.55);display:flex;flex-direction:column;justify-content:center;align-items:center;background:rgba(0,0,0,.25)}
      .pcprob b{font-size:28px;color:#ff8a00}
      .pcprob span{font-size:10px;color:#aeb6c2;text-transform:uppercase;font-weight:900}
      .pcchips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .pcchip{border-radius:7px;padding:5px 8px;font-size:10px;font-weight:950;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07)}
      .pcchip.c0{background:#ff6b00;border-color:#ff9a38}.pcchip.c1,.pcchip.c2{color:#ffb000;border-color:#ff8a00}.pcchip.c3,.pcchip.c4{color:#00e0a4;border-color:#00a981}
      .pcbiggrid,.pcgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
      .pcm{background:rgba(13,19,24,.86);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px;min-height:48px}
      .pcm label{display:block;color:#8e98a3;font-size:9px;font-weight:900;text-transform:uppercase;line-height:1;margin-bottom:5px}
      .pcm b{font-size:15px;line-height:1;color:#93ff2d}
      .pcbars,.pcprofile{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:10px 0}
      .pcbar{background:rgba(13,19,24,.7);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:8px}
      .pcbar-top{display:flex;justify-content:space-between;font-size:11px;font-weight:900;color:#aeb6c2;margin-bottom:6px}
      .pcbar-top b{color:#ff8a00}
      .pcbar-track{height:8px;background:#151a20;border-radius:999px;overflow:hidden}
      .pcbar-fill{height:100%;background:linear-gradient(90deg,#ff6b00,#ffb000,#93ff2d);border-radius:999px}
      .pctabs{display:flex;gap:6px;overflow:auto;background:#151a20;border-radius:12px;padding:7px;margin:12px 0}
      .pctab{background:transparent;color:#8e98a3;border:0;border-radius:10px;padding:11px 15px;font-size:15px;font-weight:900;cursor:pointer}
      .pctab.on{color:#fff;background:#080b0f;border:2px solid #ff7448}
      #pcTabBody{min-height:210px}
      .pczones{display:grid;grid-template-columns:repeat(3,max-content);gap:8px;align-items:start}
      .pcz{background:rgba(13,19,24,.86);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:7px;width:max-content}
      .pcz h4{font-size:11px;line-height:1;margin:0 0 5px}
      .pcz div{display:grid;grid-template-columns:repeat(5,30px);gap:1px}
      .pcz span{width:30px;height:30px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;background:#141922}
      .z2{background:#183d34!important}.z3{background:#496315!important}.z4{background:#9a6b11!important}.z5{background:#ffb423!important}
      .pcs{width:100%;height:300px;background:#071111;border:1px solid rgba(255,255,255,.07);border-radius:12px}
      .pcwhy{background:rgba(13,19,24,.86);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:13px;line-height:1.5;color:#dce3ea}
      .pcl7hero{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px}
      .pcl7hero div{background:rgba(255,106,0,.10);border:1px solid rgba(255,116,72,.28);border-radius:12px;padding:12px;text-align:center}
      .pcl7hero b{display:block;color:#ffb000;font-size:24px}.pcl7hero span{font-size:10px;color:#aeb6c2;text-transform:uppercase;font-weight:900}
      .pctable{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:#182026;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;margin-top:10px}
      .pctable div{background:#0d1318;padding:8px;font-size:12px}
      @media(max-width:850px){#pcBox{max-width:94vw}.pcbiggrid,.pcgrid,.pcbars,.pcprofile{grid-template-columns:repeat(2,1fr)}.pczones{grid-template-columns:repeat(2,max-content)}.pcl7hero{grid-template-columns:repeat(2,1fr)}}
    `;
    document.head.appendChild(style);
  }

  async function boot() {
    css();

    const decision = await getJSON("./data/hr_decision_center.json", {});
    const homeRuns = await getJSON("./data/mlb_home_runs.json", []);
    const cardDataRaw = await getJSON("./data/player_card_data.json", { players: [] });
    ZONES = await getJSON("./data/statcast_zones.json", {});
    SPRAY = await getJSON("./data/player_spray_charts.json", {});

    CARD_DATA = {
      byId: {},
      byName: {}
    };

    arr(cardDataRaw).forEach(row => {
      if (row.playerId) CARD_DATA.byId[String(row.playerId)] = row;
      if (row.player) CARD_DATA.byName[key(row.player)] = row;
    });

    const map = new Map();
    [...arr(decision), ...arr(homeRuns), ...arr(cardDataRaw)].forEach(row => {
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
