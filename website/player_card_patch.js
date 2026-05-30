(() => {
  let PLAYERS = [];
  let SPRAY = {};
  let ZONES = {};
  let CARD_DATA = {};
  let PITCH_DAMAGE = {};
  let ATTACK_ZONES = {};
  let SPOT_DATA = {};
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

  function hrChance(row) {
    const score = num(
      row.hrConfidence ??
      row.score ??
      row.hrVolatilityScore ??
      row.powerScore
    );

    const archetype = num(row.hrArchetypeScore);
    const ceiling = num(row.multiHrCeilingScore);
    const launch = num(row.launchHrProfileScore);
    const pitch = num(row.pitchTypeDestructionScore);
    const pitcherRisk = num(row.pitcherRisk);
    const pullWind = num(row.pullWindHrScore);
    const bullpen = num(row.bullpenInheritanceScore);

    let chance =
      3.5 +
      score * 0.205 +
      archetype * 0.028 +
      ceiling * 0.025 +
      launch * 0.020 +
      pitch * 0.018 +
      pitcherRisk * 0.018 +
      pullWind * 0.014 +
      bullpen * 0.010;

    if (score >= 85) chance += 4.0;
    else if (score >= 75) chance += 3.0;
    else if (score >= 65) chance += 2.0;
    else if (score >= 55) chance += 1.0;

    if (ceiling >= 80) chance += 2.0;
    if (archetype >= 90) chance += 2.0;
    if (pitcherRisk >= 85) chance += 1.5;
    if (launch >= 75) chance += 1.2;

    return Math.max(2.5, Math.min(32, chance));
  }


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
      const n = num(raw);

      let cls = "z1";
      if (title === "AVG") {
        cls = n >= .330 ? "zdanger" : n >= .290 ? "z5" : n >= .260 ? "z4" : n >= .230 ? "z3" : n >= .200 ? "z2" : "z1";
      } else if (title === "ISO") {
        cls = n >= .300 ? "zdanger" : n >= .220 ? "z5" : n >= .170 ? "z4" : n >= .120 ? "z3" : n >= .080 ? "z2" : "z1";
      } else if (title === "SLG") {
        cls = n >= .560 ? "zdanger" : n >= .480 ? "z5" : n >= .400 ? "z4" : n >= .330 ? "z3" : n >= .260 ? "z2" : "z1";
      } else if (title === "HR") {
        cls = n >= 2 ? "zdanger" : n >= 1 ? "z5" : "z1";
      } else {
        const score = n > 1 ? n : n * 100;
        cls = score >= 55 ? "zdanger" : score >= 40 ? "z5" : score >= 25 ? "z4" : score >= 15 ? "z3" : score >= 5 ? "z2" : "z1";
      }

      const txt = mode === "dec" ? dec(raw) : String(Math.round(n));
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


  function reasonList(row) {
    const h = stats(row);
    const reasons = [];

    if (num(h.HR) > 0) reasons.push(`${h.HR} season HR`);
    if (num(h.SLG) >= .500) reasons.push(`${dec(h.SLG)} SLG power profile`);
    if (num(h.OPS) >= .850) reasons.push(`${dec(h.OPS)} OPS run producing ceiling`);
    if (num(row.hotZoneCount) > 0) reasons.push(`${row.hotZoneCount} hot zones`);
    if (num(row.hitterZonePower) > 0) reasons.push(`${one(row.hitterZonePower)} zone power`);
    if (num(row.pitcherRisk) > 0) reasons.push(`${one(row.pitcherRisk)} pitcher risk`);
    if (num(row.pitchTypeDestructionScore) > 0) reasons.push(`${one(row.pitchTypeDestructionScore)} pitch type edge`);
    if (num(row.pullWindHrScore || row.weather) > 0) reasons.push(`Weather carry boost active`);
    if (num(row.bullpenInheritanceScore || row.bullpen) > 0) reasons.push(`Bullpen HR risk active`);

    return reasons.slice(0, 7);
  }

  function edgeStrength(row) {
    const h = stats(row);
    const score = (
      hrChance(row) * 1.7 +
      num(row.hitterZonePower) * .015 +
      num(row.pitcherRisk) * .018 +
      num(row.pitchTypeDestructionScore) * .018 +
      num(row.hotZoneCount) * .32 +
      num(h.SLG) * 3.5 +
      num(h.OPS) * 1.6 +
      num(row.pullWindHrScore || row.weather) * .014 +
      num(row.bullpenInheritanceScore || row.bullpen) * .012
    );

    return Math.max(1, Math.min(10, score / 8.5));
  }

  function decisionMetric(label, value, tag = "") {
    const n = num(value);
    const cls = n >= 75 ? "elite" : n >= 55 ? "strong" : n >= 35 ? "live" : "watch";

    return `
      <div class="pcdecision ${cls}">
        <span>${esc(label)}</span>
        <strong>${esc(one(value))}</strong>
        <em>${esc(tag || cls.toUpperCase())}</em>
      </div>
    `;
  }

  function renderDecisionGrid(row) {
    return `
      <div class="pcdecision-grid">
        ${decisionMetric("Hitter Power", row.powerScore || row.hitterZonePower, "Power")}
        ${decisionMetric("Pitcher Attack", row.pitcherRisk, "Risk")}
        ${decisionMetric("Zone Matchup", row.zoneOverlap || row.hotZoneCount * 12, "Overlap")}
        ${decisionMetric("Pitch Edge", row.pitchTypeDestructionScore, "Pitch")}
        ${decisionMetric("Weather Edge", row.pullWindHrScore || row.weather, "Carry")}
        ${decisionMetric("Bullpen Edge", row.bullpenInheritanceScore || row.bullpen, "Late")}
      </div>
    `;
  }

  function renderHrCase(row) {
    const reasons = reasonList(row);
    const strength = edgeStrength(row);

    return `
      <section class="pccase">
        <div class="pccase-main">
          <div>
            <span>HR Case</span>
            <h3>Why ${esc(row.player)}</h3>
            <p>${esc(whyText(row))}</p>
          </div>
          <div class="pccase-score">
            <strong>${one(strength)}</strong>
            <small>Edge Strength</small>
          </div>
        </div>

        <div class="pcreasons">
          ${reasons.length ? reasons.map(r => `<div class="pcreason">✓ ${esc(r)}</div>`).join("") : `<div class="pcreason">Building matchup reasons</div>`}
        </div>
      </section>
    `;
  }

  function renderMatchupIntel(row) {
    const h = stats(row);
    const pitcher = row.opposingPitcher || row.pitcher || "Projected pitcher";
    const pitcherHand = row.pitcherHand || row.throwingHand || row.opposingPitcherHand || "N/A";
    const matchupGrade = grade(row);

    return `
      <section class="pcintel">
        <div class="pcsection-head">
          <div>
            <h3>Matchup Intel</h3>
            <p>Quick read on hitter power, pitcher risk, weather, and late game boost</p>
          </div>
          <span>${esc(matchupGrade)}</span>
        </div>

        <div class="pcintel-grid">
          ${metric("Pitcher", pitcher)}
          ${metric("Throws", pitcherHand)}
          ${metric("SLG", dec(h.SLG))}
          ${metric("OPS", dec(h.OPS))}
          ${metric("Pitcher Risk", one(row.pitcherRisk))}
          ${metric("Pitch Edge", one(row.pitchTypeDestructionScore))}
          ${metric("Weather Edge", one(row.pullWindHrScore || row.weather))}
          ${metric("Bullpen Edge", one(row.bullpenInheritanceScore || row.bullpen))}
        </div>
      </section>
    `;
  }

  function renderWhyTab(row) {
    const reasons = reasonList(row);
    const strength = edgeStrength(row);

    return `
      <div class="pcwhy">
        <div class="pcwhy-hero">
          <div>
            <h3>Why This Bat</h3>
            <p>${esc(whyText(row))}</p>
          </div>
          <div class="pcwhy-score">
            <strong>${one(strength)}</strong>
            <span>HR Case</span>
          </div>
        </div>

        <div class="pcwhy-list">
          ${reasons.length ? reasons.map((r, i) => `
            <div class="pcwhy-row">
              <b>${i + 1}</b>
              <span>${esc(r)}</span>
            </div>
          `).join("") : `<div class="pcwhy-row"><b>1</b><span>Matchup detail is still building</span></div>`}
        </div>

        ${renderMatchupIntel(row)}
      </div>
    `;
  }

  function attackCellsFor(row) {
    const attack = attackFor(row) || {};
    const z = attack.zones || {};
    const raw = Array.isArray(z.zones) ? z.zones : [];

    const hitterPower = num(z.hitterPower || row.hitterZonePower || row.truePowerScore || row.powerScore);
    const pitcherLeak = num(z.pitcherLeak || row.pitcherRisk || row.hrLeakFactor);

    return Array.from({ length: 25 }, (_, i) => {
      const cell = raw[i] || {};
      const danger = num(cell.danger);

      const pitcher = danger || pitcherLeak;
      const overlap = danger;
      const value = Math.max(danger, hitterPower, pitcherLeak);

      return {
        pitcher,
        overlap,
        value
      };
    });
  }

  function renderZoneOverlapCard(row) {
    const overlap = Math.max(
      num(row.zoneOverlap),
      num(row.hotZoneCount),
      num(row.hitterZonePower) / 12
    );

    const label = overlap >= 7 ? "Elite" : overlap >= 5 ? "Strong" : overlap >= 3 ? "Live" : "Building";

    return `
      <div class="pcoverlap-card">
        <span>Zone Overlap</span>
        <strong>${one(overlap)}</strong>
        <em>${label}</em>
      </div>
    `;
  }


  function playerLookup(store, row) {
    const players = store?.players || store || {};
    return players[String(row.playerId || "")] || players[row.player] || players[key(row.player)] || null;
  }

  function pitchDamageFor(row) {
    return playerLookup(PITCH_DAMAGE, row)?.pitchDamage || {};
  }

  function attackFor(row) {
    return playerLookup(ATTACK_ZONES, row);
  }

  function spotFor(row) {
    const rows = arr(SPOT_DATA);
    return rows.find(x => String(x.playerId || "") === String(row.playerId || "")) ||
      rows.find(x => key(x.player) === key(row.player)) ||
      null;
  }


  function bullpenRowsFor(row) {
    const opponent = key(row.opponent);
    const collapseRows = arr(window.__SLIP_BULLPEN_DATA__ || []);

    return collapseRows.filter(bp => {
      const bpTeam =
        key(bp.team) ||
        key(bp.Team) ||
        key(bp.opponent) ||
        key(bp.pitchingTeam);

      return bpTeam === opponent;
    });
  }

  async function getBullpenData() {
    if (window.__SLIP_BULLPEN_DATA__) return window.__SLIP_BULLPEN_DATA__;
    const relievers = await getJSON("./data/bullpen_relievers.json", { players: [] });
    window.__SLIP_BULLPEN_DATA__ = relievers.players || [];
    return window.__SLIP_BULLPEN_DATA__;
  }

  function bullpenName(bp) {
    return bp.name || bp.pitcher || bp.player || bp.reliever || bp.fullName || "Reliever";
  }

  function bullpenHand(bp) {
    return bp.hand || bp.throws || bp.pitchHand || bp.pitcherHand || "";
  }

  function bullpenRisk(bp) {
    return Math.max(
      num(bp.hrRiskScore),
      num(bp.collapseScore),
      num(bp.dangerScore),
      num(bp.bullpenScore),
      num(bp.hr9) * 25,
      num(bp.homeRunsAllowed) * 6,
      num(bp.barrelRate) * 7,
      num(bp.hardHitRate) * 1.4
    );
  }

  function bullpenTag(score) {
    if (score >= 75) return "HR Leak";
    if (score >= 60) return "Danger";
    if (score >= 42) return "Watch";
    return "Stable";
  }

  function renderBullpenTab(row, rows = []) {
    const team = row.opponent || "Opponent";
    const inherited = num(row.bullpenInheritanceScore || row.bullpen);
    const relievers = rows
      .slice()
      .sort((a, b) => bullpenRisk(b) - bullpenRisk(a))
      .slice(0, 6);

    return `
      <div class="pcsection-head">
        <div>
          <h3>Bullpen Inheritance</h3>
          <p>Late game HR risk after the starter exits</p>
        </div>
        <span>${esc(row.bullpenInheritanceTag || "Bullpen Edge")}</span>
      </div>

      <div class="pcgrid">
        ${metric("Opponent Bullpen", team)}
        ${metric("Inheritance Score", one(inherited))}
        ${metric("Bullpen Boost", one(row.bullpenInheritanceBonus))}
        ${metric("Late HR Tag", row.bullpenInheritanceTag || "Neutral")}
      </div>

      <div class="pcspottable">
        <div class="pcpitchrow head">
          <span>Reliever</span><span>Hand</span><span>HR Risk</span><span>HR/9</span><span>Tag</span>
        </div>

        ${relievers.length ? relievers.map(bp => {
          const risk = bullpenRisk(bp);
          const tag = bullpenTag(risk);
          const cls = risk >= 60 ? "hot" : risk >= 42 ? "good" : "";
          return `
            <div class="pcpitchrow">
              <strong>${esc(bullpenName(bp))}</strong>
              <span>${esc(bullpenHand(bp) || "N/A")}</span>
              <span class="${cls}">${one(risk)}</span>
              <span>${esc(bp.hr9 ?? "N/A")}</span>
              <span class="${cls}">${esc(bp.tag || tag)}</span>
            </div>
          `;
        }).join("") : `
          <div class="pcwhy">
            Specific reliever data is still building. Current bullpen score is based on team bullpen risk, starter risk, HR leak, and late game power profile.
          </div>
        `}
      </div>
    `;
  }

  function miniZone(title, values, mode = "score") {
    const cells = Array.isArray(values) ? values.slice(0, 25) : Array.from({ length: 25 }, () => 0);
    const max = Math.max(...cells.map(v => num(v)), 1);
    return `<div class="pcz"><h4>${esc(title)}</h4><div>${cells.map(v => {
      const raw = num(v);
      const score = mode === "dec" ? raw / max * 100 : raw;
      const cls =
        mode === "dec"
          ? score >= 60 ? "zdanger" : score >= 50 ? "z5" : score >= 40 ? "z4" : score >= 30 ? "z3" : score >= 20 ? "z2" : "z1"
          : mode === "cnt"
            ? score >= 50 ? "zdanger" : score >= 35 ? "z5" : score >= 25 ? "z4" : score >= 15 ? "z3" : score >= 5 ? "z2" : "z1"
            : score >= 70 ? "zdanger" : score >= 55 ? "z5" : score >= 40 ? "z4" : score >= 25 ? "z3" : score >= 15 ? "z2" : "z1";
      const txt = mode === "dec" ? dec(raw) : Math.round(raw);
      return `<span class="${cls}">${txt}</span>`;
    }).join("")}</div></div>`;
  }

  function renderPitchSummary(row) {
    const score = num(row.pitchTypeDestructionScore);
    const risk = num(row.pitcherRisk);
    const pitch = row.bestPitch || row.pitchTypeDestructionPitch || "N/A";

    let tag = row.pitchTypeDestructionTag || "Watch";
    if (!row.pitchTypeDestructionTag) {
      if (score >= 80) tag = "Pitch Crusher";
      else if (score >= 65) tag = "Strong Edge";
      else if (score >= 50) tag = "Playable";
      else tag = "Watch";
    }

    return `
      <div class="pcpitch-summary">
        <div class="pcpitch-card">
          <span>Best Pitch</span>
          <strong>${esc(pitch)}</strong>
        </div>

        <div class="pcpitch-card">
          <span>Pitch Score</span>
          <strong>${one(score)}</strong>
        </div>

        <div class="pcpitch-card">
          <span>Pitcher Risk</span>
          <strong>${one(risk)}</strong>
        </div>

        <div class="pcpitch-card hot">
          <span>Attack Tag</span>
          <strong>${esc(tag)}</strong>
        </div>
      </div>
    `;
  }

  function renderPitchTab(row) {
    const damage = pitchDamageFor(row);
    const attack = attackFor(row);
    const attackRows = attack?.zones?.zones || attack?.zones || [];
    const attackValues = Array.from({ length: 25 }, (_, i) => {
      const found = attackRows.find(z => Number(z.zone) === i + 1 || Number(z.index) === i);
      return found?.danger ?? found?.value ?? 0;
    });

    const pitchRows = Object.values(damage);

    return `
      <div class="pcsection-head">
        <div>
          <h3>Pitch Matchup</h3>
          <p>How this hitter performs against the pitcher mix</p>
        </div>
        <span>${esc(row.bestPitch || "Best pitch loading")}</span>
      </div>

      ${renderPitchSummary(row)}

      <div class="pcgrid">
        ${metric("Best Pitch", row.bestPitch)}
        ${metric("Pitch Edge", one(row.pitchEdge))}
        ${metric("Pitcher Risk", one(row.pitcherRisk))}
        ${metric("Zone Overlap", one(row.zoneOverlap))}
        ${metric("Hitter Zone Power", one(row.hitterZonePower))}
        ${metric("Hot Zones", row.hotZoneCount)}
      </div>

      <div class="pcpitchtable">
        <div class="pcpitchrow head">
          <span>Pitch</span><span>AVG</span><span>SLG</span><span>HR</span><span>Crush</span>
        </div>
        ${pitchRows.map(p => `
          <div class="pcpitchrow">
            <strong>${esc(p.label || "Pitch")}</strong>
            <span>${dec(p.avg)}</span>
            <span class="good">${dec(p.slg)}</span>
            <span class="hot">${esc(p.hr ?? 0)}</span>
            <span><i style="width:${Math.max(4, Math.min(100, num(p.crush)))}%"></i>${one(p.crush)}</span>
          </div>
        `).join("") || `<div class="pcwhy">Pitch type damage is building for this player.</div>`}
      </div>

      <div class="pczones">
        ${miniZone("Pitcher Attack Zones", attackValues)}
        ${zones("Hitter ISO", row.isoZones, null, "dec")}
        ${zones("Hitter SLG", row.slgZones, null, "dec")}
        ${zones("HR Zones", row.hrZones, null, "cnt")}
      </div>
    `;
  }

  function renderSpotTab(row) {
    const spot = spotFor(row);

    if (!spot?.spots) {
      return `<h3>Spot Lab</h3><div class="pcwhy">Batting spot history is building for this player.</div>`;
    }

    const rows = Object.values(spot.spots).sort((a, b) => Number(a.lineupSpot) - Number(b.lineupSpot));
    const maxOps = Math.max(...rows.map(r => num(r.ops)), 1);
    const maxHr = Math.max(...rows.map(r => num(r.hr)), 1);

    return `
      <div class="pcsection-head">
        <div>
          <h3>Spot Lab</h3>
          <p>Production by batting order spot this season</p>
        </div>
        <span>Projected #${esc(spot.projectedSpot)}</span>
      </div>

      <div class="pcgrid">
        ${metric("Projected Spot", "#" + spot.projectedSpot)}
        ${metric("Best Spot", "#" + spot.bestSpot)}
        ${metric("Worst Spot", "#" + spot.worstSpot)}
      </div>

      <div class="pcspottable">
        ${rows.map(r => {
          const current = Number(r.lineupSpot) === Number(spot.projectedSpot);
          const opsWidth = Math.max(4, Math.round(num(r.ops) / maxOps * 100));
          const hrWidth = Math.max(4, Math.round(num(r.hr) / maxHr * 100));
          return `
            <div class="pcspotrow ${current ? "on" : ""}">
              <div class="pcspotleft">
                <b>${current ? "★" : "#" + esc(r.lineupSpot)}</b>
                <span>${esc(r.pa || 0)} PA</span>
              </div>
              <div class="pcspotbars">
                <div><label>OPS ${dec(r.ops)}</label><i class="opsbar" style="width:${opsWidth}%"></i></div>
                <div><label>HR ${esc(r.hr || 0)}</label><i class="hrbar" style="width:${hrWidth}%"></i></div>
              </div>
              <div class="pcspotright">
                <span>${dec(r.avg)} AVG</span>
                <span>${dec(r.slg)} SLG</span>
                <span>${esc(r.tb || 0)} TB</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderRecentFormTab(row) {
    const logs = Array.isArray(row.gameLogs) ? row.gameLogs : [];
    const last7 = row.last7 || {};
    const recent = logs.slice(0, 7);

    const hr = num(last7.hr ?? last7.homeRuns ?? recent.reduce((s, g) => s + num(g.hr || g.homeRuns), 0));
    const hits = num(last7.hits ?? recent.reduce((s, g) => s + num(g.hits), 0));
    const tb = num(last7.tb ?? last7.totalBases ?? recent.reduce((s, g) => s + num(g.tb || g.totalBases), 0));
    const ab = num(last7.ab ?? last7.atBats ?? recent.reduce((s, g) => s + num(g.ab || g.atBats), 0));
    const avg = ab ? hits / ab : num(last7.avg);
    const slg = ab ? tb / ab : num(last7.slg);

    const trend =
      hr >= 2 || slg >= .650 ? "Heating Up" :
      hr >= 1 || slg >= .500 ? "Live" :
      hits >= 6 ? "Contact Ready" :
      "Building";

    return `
      <div class="pcrecent">
        <div class="pcsection-head">
          <div>
            <h3>Recent Form</h3>
            <p>Last 7 game power and contact trend</p>
          </div>
          <span>${trend}</span>
        </div>

        <div class="pcl7hero">
          ${metric("Last 7 HR", hr)}
          ${metric("Hits", hits)}
          ${metric("Total Bases", tb)}
          ${metric("AVG", dec(avg))}
          ${metric("SLG", dec(slg))}
          ${metric("Trend", trend)}
        </div>

        <div class="pcrecent-note">
          ${hr >= 2 ? "Multiple recent HRs show the power is active right now." :
            hr >= 1 ? "Recent HR keeps the bat live for another power spike." :
            slg >= .500 ? "Extra base production is showing even without a recent HR." :
            "Recent form is more neutral, so the case needs to come from matchup, zones, or weather."}
        </div>
      </div>
    `;
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

  function pcTheme(row) {
    const tags = Array.isArray(row.tags) ? row.tags.join(" ") : "";
    const prob = Number(row.realHrProbability || row.projectedHrProbability || 0);
    const power = Number(row.truePowerScore || row.hrPowerIndex || row.score || 0);

    if (prob >= 16 || power >= 74 || tags.includes("NUCLEAR") || tags.includes("ELITE POWER")) return "fire";
    if (prob <= 3.5 && power <= 32) return "ice";
    return "neutral";
  }

  function renderHero(row) {
    const h = stats(row);
    const conf = hrChance(row);
    const prob = Math.max(3, Math.min(25, conf / 4));
    const theme = pcTheme(row);

    return `
      <div class="pcheader pctheme-${theme}">
        <div>
          <h2>${esc(row.player)}</h2>
          <p>${esc(row.team)} vs ${esc(row.opponent)}${row.opposingPitcher ? " • vs " + esc(row.opposingPitcher) : ""}</p>
          <div class="pcchips">${chips(row)}</div>
        </div>
        <div class="pcprob">
          <b>${one(hrChance(row))}%</b>
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

      ${renderHrCase(row)}
      ${renderMatchupIntel(row)}

      <div class="pcbars">
        ${bar("HR Chance", conf, 24, "%")}
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
      body.innerHTML = `<div class="pczones">${zones("AVG", row.avgZones, null, "dec")}${zones("ISO", row.isoZones, null, "dec")}${zones("SLG", row.slgZones, null, "dec")}${zones("HR", row.hrZones, null, "cnt")}${zones("Pitcher Leak", attackCellsFor(row), "pitcher")}${zones("Zone Overlap", attackCellsFor(row), "overlap")}</div>`;
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
      body.innerHTML = renderSpotTab(row);
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
      body.innerHTML = renderPitchTab(row);
      return;
    }

    if (id === "bp") {
      body.innerHTML = renderBullpenTab(row, []);

      getBullpenData().then(bpRows => {
        const filtered = bullpenRowsFor(row);
        body.innerHTML = renderBullpenTab(row, filtered);
      });

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
      #pcBox{max-width:980px;margin:auto;background:linear-gradient(180deg,#080d12,#070a0f 45%,#080d12);border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:14px;color:#f3f3f3;box-shadow:0 0 42px rgba(0,0,0,.36)}
      #pcBox h2{font-size:28px;line-height:1.05;margin:0;color:#fff}
      #pcBox p{font-size:13px;margin:6px 0 10px;color:#b9c0ca}
      #pcBox h3{font-size:13px;line-height:1;margin:14px 0 10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2}
      #pcClose{float:right;background:#111820;color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:8px 11px;font-size:11px;font-weight:900;cursor:pointer}
      .pcheader{position:relative;overflow:hidden;display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:14px;border-radius:16px;background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.08);margin-bottom:10px}
      .pcheader>*{position:relative;z-index:2}
      .pcheader.pctheme-fire::before,.pcheader.pctheme-ice::before{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;opacity:.55}
      .pcheader.pctheme-fire::before{background:radial-gradient(circle at 15% 18%,rgba(255,115,24,.95),transparent 34%),radial-gradient(circle at 84% 48%,rgba(255,45,35,.55),transparent 31%),linear-gradient(135deg,rgba(255,128,0,.42),transparent 62%)}
      .pcheader.pctheme-ice::before{background:radial-gradient(circle at 15% 18%,rgba(95,210,255,.95),transparent 34%),radial-gradient(circle at 84% 48%,rgba(220,248,255,.62),transparent 31%),linear-gradient(135deg,rgba(75,160,255,.42),transparent 62%)}
      .pcheader.pctheme-fire{border-color:rgba(255,126,35,.46)}
      .pcheader.pctheme-ice{border-color:rgba(110,215,255,.42)}
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
      .z2{background:#183d34!important}.z3{background:#496315!important}.z4{background:#9a6b11!important}.z5{background:#ffb423!important}.zdanger{background:#ff2f2f!important;color:#fff!important;box-shadow:0 0 12px rgba(255,47,47,.55)!important}
      .pcs{width:100%;height:300px;background:#071111;border:1px solid rgba(255,255,255,.07);border-radius:12px}
      .pcwhy{background:rgba(13,19,24,.86);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:13px;line-height:1.5;color:#dce3ea}
      .pcl7hero{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px}
      .pcl7hero div{background:rgba(255,106,0,.10);border:1px solid rgba(255,116,72,.28);border-radius:12px;padding:12px;text-align:center}
      .pcl7hero b{display:block;color:#ffb000;font-size:24px}.pcl7hero span{font-size:10px;color:#aeb6c2;text-transform:uppercase;font-weight:900}
      .pctable{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:#182026;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;margin-top:10px}
      .pctable div{background:#0d1318;padding:8px;font-size:12px}

      .pccase{margin:12px 0;border:1px solid rgba(255,122,35,.28);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.12),rgba(140,255,50,.045));padding:13px}
      .pccase-main{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pccase-main span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#ffb000;font-weight:950}
      .pccase-main h3{margin:4px 0 7px!important;color:#fff!important;font-size:17px!important;letter-spacing:0!important;text-transform:none!important}
      .pccase-main p{margin:0!important;color:#d7dde4!important;line-height:1.4!important}
      .pccase-score{min-width:86px;text-align:center;border:1px solid rgba(140,255,50,.24);border-radius:14px;background:rgba(0,0,0,.22);padding:10px}
      .pccase-score strong{display:block;color:#8cff32;font-size:28px;line-height:1}
      .pccase-score small{display:block;margin-top:5px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcreasons{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:12px}
      .pcreason{border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.045);padding:8px 9px;font-size:12px;color:#fff;font-weight:850}
      .pcintel{margin:12px 0;border:1px solid rgba(255,255,255,.09);border-radius:16px;background:rgba(255,255,255,.035);padding:12px}
      .pcintel-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcwhy-hero{display:flex;justify-content:space-between;gap:14px;border:1px solid rgba(140,255,50,.20);border-radius:16px;background:rgba(140,255,50,.05);padding:14px;margin-bottom:12px}
      .pcwhy-hero h3{margin:0 0 7px!important;color:#8cff32!important}
      .pcwhy-hero p{margin:0!important;color:#d8dee6!important;line-height:1.45!important}
      .pcwhy-score{min-width:96px;text-align:center;border:1px solid rgba(140,255,50,.24);border-radius:14px;background:rgba(0,0,0,.22);padding:12px}
      .pcwhy-score strong{display:block;color:#8cff32;font-size:32px;line-height:1}
      .pcwhy-score span{display:block;margin-top:5px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcwhy-list{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px}
      .pcwhy-row{display:flex;align-items:center;gap:9px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:rgba(255,255,255,.04);padding:10px}
      .pcwhy-row b{width:25px;height:25px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,122,35,.18);color:#ff9b2f}
      .pcwhy-row span{font-size:13px;color:#fff;font-weight:850}
      .pcoverlap-card{border:1px solid rgba(140,255,50,.22);border-radius:14px;background:rgba(140,255,50,.06);padding:12px;text-align:center;align-self:start}
      .pcoverlap-card span,.pcoverlap-card em{display:block;text-transform:uppercase;font-size:10px;font-weight:950;color:#aeb6c2}
      .pcoverlap-card strong{display:block;color:#8cff32;font-size:36px;line-height:1.05;margin:7px 0}
      .pcoverlap-card em{color:#ffb000}

      .pchead.upgraded{display:grid!important;grid-template-columns:1fr 120px auto;gap:14px;align-items:center;background:linear-gradient(135deg,rgba(255,122,35,.24),rgba(120,30,50,.32));border:1px solid rgba(255,122,35,.36);border-radius:18px;padding:14px!important;margin-bottom:12px}
      .pcplayer-main{display:flex;align-items:center;gap:13px;min-width:0}
      .pcavatar{width:54px;height:54px;border-radius:16px;background:linear-gradient(135deg,#ff7a23,#8cff32);display:flex;align-items:center;justify-content:center;color:#061010;font-weight:950;font-size:20px;box-shadow:0 8px 24px rgba(0,0,0,.30)}
      .pc-kicker{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#ffb000;font-weight:950;margin-bottom:4px}
      .pchero-score{border:1px solid rgba(255,122,35,.40);border-radius:16px;background:rgba(0,0,0,.24);text-align:center;padding:13px 10px}
      .pchero-score strong{display:block;color:#ff9b2f;font-size:30px;line-height:1;font-weight:950}
      .pchero-score span{display:block;margin-top:6px;color:#d8dee6;font-size:10px;text-transform:uppercase;font-weight:900}

      .pcdecision-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
      .pcdecision{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:11px}
      .pcdecision span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:950}
      .pcdecision strong{display:block;margin-top:5px;font-size:22px;color:#fff}
      .pcdecision em{display:inline-block;margin-top:7px;font-style:normal;font-size:10px;font-weight:950;border-radius:999px;padding:4px 8px;background:rgba(255,255,255,.07);color:#d8dee6}
      .pcdecision.elite{border-color:rgba(140,255,50,.28);background:rgba(140,255,50,.055)}
      .pcdecision.elite strong{color:#8cff32}
      .pcdecision.strong strong{color:#ffcf32}
      .pcdecision.live strong{color:#ff9b2f}
      .pcdecision.watch strong{color:#9aa6ad}

      .pczone-hero{display:grid;grid-template-columns:1fr 150px;gap:12px;align-items:stretch;margin-bottom:12px;border:1px solid rgba(140,255,50,.16);border-radius:16px;background:rgba(140,255,50,.045);padding:13px}
      .pczone-hero h3{margin:0 0 6px!important;color:#8cff32!important}
      .pczone-hero p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pczone-grid-upgraded{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
      .pczone-grid-upgraded .pcz{margin:0}
      .pczone-grid-upgraded .pcz h4{color:#ffb000!important}
      .pczone-grid-upgraded .pcz div{gap:4px}
      .pczone-grid-upgraded .pcz span{min-width:34px;min-height:26px;border-radius:8px;font-size:10px;font-weight:900}

      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcdecision-grid{grid-template-columns:repeat(2,1fr)}}


      .pczone-hero{display:grid;grid-template-columns:1fr 150px;gap:12px;align-items:stretch;margin-bottom:12px;border:1px solid rgba(140,255,50,.16);border-radius:16px;background:rgba(140,255,50,.045);padding:13px}
      .pczone-hero h3{margin:0 0 6px!important;color:#8cff32!important}
      .pczone-hero p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pczone-grid-upgraded{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
      .pczone-grid-upgraded .pcz{margin:0}
      .pczone-grid-upgraded .pcz h4{color:#ffb000!important}
      .pczone-grid-upgraded .pcz div{gap:4px}
      .pczone-grid-upgraded .pcz span{min-width:34px;min-height:26px;border-radius:8px;font-size:10px;font-weight:900}

      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pchead.upgraded{grid-template-columns:1fr}.pchero-score{text-align:left}.pcplayer-main{align-items:flex-start}}


      .pcdecision-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
      .pcdecision{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:11px}
      .pcdecision span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:950}
      .pcdecision strong{display:block;margin-top:5px;font-size:22px;color:#fff}
      .pcdecision em{display:inline-block;margin-top:7px;font-style:normal;font-size:10px;font-weight:950;border-radius:999px;padding:4px 8px;background:rgba(255,255,255,.07);color:#d8dee6}
      .pcdecision.elite{border-color:rgba(140,255,50,.28);background:rgba(140,255,50,.055)}
      .pcdecision.elite strong{color:#8cff32}
      .pcdecision.strong strong{color:#ffcf32}
      .pcdecision.live strong{color:#ff9b2f}
      .pcdecision.watch strong{color:#9aa6ad}

      .pczone-hero{display:grid;grid-template-columns:1fr 150px;gap:12px;align-items:stretch;margin-bottom:12px;border:1px solid rgba(140,255,50,.16);border-radius:16px;background:rgba(140,255,50,.045);padding:13px}
      .pczone-hero h3{margin:0 0 6px!important;color:#8cff32!important}
      .pczone-hero p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pczone-grid-upgraded{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
      .pczone-grid-upgraded .pcz{margin:0}
      .pczone-grid-upgraded .pcz h4{color:#ffb000!important}
      .pczone-grid-upgraded .pcz div{gap:4px}
      .pczone-grid-upgraded .pcz span{min-width:34px;min-height:26px;border-radius:8px;font-size:10px;font-weight:900}

      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcdecision-grid{grid-template-columns:repeat(2,1fr)}}


      .pczone-hero{display:grid;grid-template-columns:1fr 150px;gap:12px;align-items:stretch;margin-bottom:12px;border:1px solid rgba(140,255,50,.16);border-radius:16px;background:rgba(140,255,50,.045);padding:13px}
      .pczone-hero h3{margin:0 0 6px!important;color:#8cff32!important}
      .pczone-hero p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pczone-grid-upgraded{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
      .pczone-grid-upgraded .pcz{margin:0}
      .pczone-grid-upgraded .pcz h4{color:#ffb000!important}
      .pczone-grid-upgraded .pcz div{gap:4px}
      .pczone-grid-upgraded .pcz span{min-width:34px;min-height:26px;border-radius:8px;font-size:10px;font-weight:900}

      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcreasons,.pcintel-grid,.pcwhy-list{grid-template-columns:1fr}.pccase-main,.pcwhy-hero{flex-direction:column}.pccase-score,.pcwhy-score{width:100%}}


      .pchead.upgraded{display:grid!important;grid-template-columns:1fr 120px auto;gap:14px;align-items:center;background:linear-gradient(135deg,rgba(255,122,35,.24),rgba(120,30,50,.32));border:1px solid rgba(255,122,35,.36);border-radius:18px;padding:14px!important;margin-bottom:12px}
      .pcplayer-main{display:flex;align-items:center;gap:13px;min-width:0}
      .pcavatar{width:54px;height:54px;border-radius:16px;background:linear-gradient(135deg,#ff7a23,#8cff32);display:flex;align-items:center;justify-content:center;color:#061010;font-weight:950;font-size:20px;box-shadow:0 8px 24px rgba(0,0,0,.30)}
      .pc-kicker{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#ffb000;font-weight:950;margin-bottom:4px}
      .pchero-score{border:1px solid rgba(255,122,35,.40);border-radius:16px;background:rgba(0,0,0,.24);text-align:center;padding:13px 10px}
      .pchero-score strong{display:block;color:#ff9b2f;font-size:30px;line-height:1;font-weight:950}
      .pchero-score span{display:block;margin-top:6px;color:#d8dee6;font-size:10px;text-transform:uppercase;font-weight:900}

      .pcdecision-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
      .pcdecision{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:11px}
      .pcdecision span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:950}
      .pcdecision strong{display:block;margin-top:5px;font-size:22px;color:#fff}
      .pcdecision em{display:inline-block;margin-top:7px;font-style:normal;font-size:10px;font-weight:950;border-radius:999px;padding:4px 8px;background:rgba(255,255,255,.07);color:#d8dee6}
      .pcdecision.elite{border-color:rgba(140,255,50,.28);background:rgba(140,255,50,.055)}
      .pcdecision.elite strong{color:#8cff32}
      .pcdecision.strong strong{color:#ffcf32}
      .pcdecision.live strong{color:#ff9b2f}
      .pcdecision.watch strong{color:#9aa6ad}

      .pczone-hero{display:grid;grid-template-columns:1fr 150px;gap:12px;align-items:stretch;margin-bottom:12px;border:1px solid rgba(140,255,50,.16);border-radius:16px;background:rgba(140,255,50,.045);padding:13px}
      .pczone-hero h3{margin:0 0 6px!important;color:#8cff32!important}
      .pczone-hero p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pczone-grid-upgraded{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
      .pczone-grid-upgraded .pcz{margin:0}
      .pczone-grid-upgraded .pcz h4{color:#ffb000!important}
      .pczone-grid-upgraded .pcz div{gap:4px}
      .pczone-grid-upgraded .pcz span{min-width:34px;min-height:26px;border-radius:8px;font-size:10px;font-weight:900}

      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcdecision-grid{grid-template-columns:repeat(2,1fr)}}


      .pczone-hero{display:grid;grid-template-columns:1fr 150px;gap:12px;align-items:stretch;margin-bottom:12px;border:1px solid rgba(140,255,50,.16);border-radius:16px;background:rgba(140,255,50,.045);padding:13px}
      .pczone-hero h3{margin:0 0 6px!important;color:#8cff32!important}
      .pczone-hero p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pczone-grid-upgraded{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
      .pczone-grid-upgraded .pcz{margin:0}
      .pczone-grid-upgraded .pcz h4{color:#ffb000!important}
      .pczone-grid-upgraded .pcz div{gap:4px}
      .pczone-grid-upgraded .pcz span{min-width:34px;min-height:26px;border-radius:8px;font-size:10px;font-weight:900}

      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pchead.upgraded{grid-template-columns:1fr}.pchero-score{text-align:left}.pcplayer-main{align-items:flex-start}}


      .pcdecision-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
      .pcdecision{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:11px}
      .pcdecision span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:950}
      .pcdecision strong{display:block;margin-top:5px;font-size:22px;color:#fff}
      .pcdecision em{display:inline-block;margin-top:7px;font-style:normal;font-size:10px;font-weight:950;border-radius:999px;padding:4px 8px;background:rgba(255,255,255,.07);color:#d8dee6}
      .pcdecision.elite{border-color:rgba(140,255,50,.28);background:rgba(140,255,50,.055)}
      .pcdecision.elite strong{color:#8cff32}
      .pcdecision.strong strong{color:#ffcf32}
      .pcdecision.live strong{color:#ff9b2f}
      .pcdecision.watch strong{color:#9aa6ad}

      .pczone-hero{display:grid;grid-template-columns:1fr 150px;gap:12px;align-items:stretch;margin-bottom:12px;border:1px solid rgba(140,255,50,.16);border-radius:16px;background:rgba(140,255,50,.045);padding:13px}
      .pczone-hero h3{margin:0 0 6px!important;color:#8cff32!important}
      .pczone-hero p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pczone-grid-upgraded{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
      .pczone-grid-upgraded .pcz{margin:0}
      .pczone-grid-upgraded .pcz h4{color:#ffb000!important}
      .pczone-grid-upgraded .pcz div{gap:4px}
      .pczone-grid-upgraded .pcz span{min-width:34px;min-height:26px;border-radius:8px;font-size:10px;font-weight:900}

      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcdecision-grid{grid-template-columns:repeat(2,1fr)}}


      .pczone-hero{display:grid;grid-template-columns:1fr 150px;gap:12px;align-items:stretch;margin-bottom:12px;border:1px solid rgba(140,255,50,.16);border-radius:16px;background:rgba(140,255,50,.045);padding:13px}
      .pczone-hero h3{margin:0 0 6px!important;color:#8cff32!important}
      .pczone-hero p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pczone-grid-upgraded{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
      .pczone-grid-upgraded .pcz{margin:0}
      .pczone-grid-upgraded .pcz h4{color:#ffb000!important}
      .pczone-grid-upgraded .pcz div{gap:4px}
      .pczone-grid-upgraded .pcz span{min-width:34px;min-height:26px;border-radius:8px;font-size:10px;font-weight:900}

      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}

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
    PITCH_DAMAGE = await getJSON("./data/pitch_type_damage.json", {});
      ATTACK_ZONES = await getJSON("./data/pitcher_attack_zones.json", {});
      SPOT_DATA = await getJSON("./data/batting_spot_profiles.json", { players: [] });
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
      const target = event.target.closest(".bat[data-player],tr[data-player],.player-card[data-player-name],.card[data-player-name],[data-player-name]");
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

(() => {
  const css = `
    .pcsection-head {
      display: flex !important;
      align-items: flex-start !important;
      justify-content: space-between !important;
      gap: 14px !important;
      margin: 4px 0 14px !important;
    }

    .pcsection-head h3 {
      margin: 0 !important;
      color: #ff8a1f !important;
      letter-spacing: .08em !important;
      text-transform: uppercase !important;
    }

    .pcsection-head p {
      margin: 4px 0 0 !important;
      color: #9aa3b2 !important;
      font-size: 14px !important;
    }

    .pcsection-head span {
      border: 1px solid rgba(255,132,0,.35) !important;
      background: rgba(255,132,0,.12) !important;
      color: #7cff35 !important;
      border-radius: 10px !important;
      padding: 8px 12px !important;
      font-weight: 900 !important;
    }

    .pcpitchtable,
    .pcspottable {
      margin-top: 14px !important;
      border: 1px solid rgba(255,255,255,.08) !important;
      border-radius: 14px !important;
      overflow: hidden !important;
      background: rgba(5,8,13,.72) !important;
    }

    .pcpitchrow {
      display: grid !important;
      grid-template-columns: 1.5fr repeat(4, 1fr) !important;
      gap: 10px !important;
      align-items: center !important;
      padding: 12px 14px !important;
      border-bottom: 1px solid rgba(255,255,255,.07) !important;
    }

    .pcpitchrow.head {
      color: #9aa3b2 !important;
      text-transform: uppercase !important;
      font-size: 12px !important;
      font-weight: 900 !important;
      background: rgba(255,255,255,.04) !important;
    }

    .pcpitchrow strong {
      color: #ff8a1f !important;
    }

    .pcpitchrow .good {
      color: #7cff35 !important;
    }

    .pcpitchrow .hot {
      color: #ff9d00 !important;
    }

    .pcpitchrow i {
      display: inline-block !important;
      height: 8px !important;
      border-radius: 999px !important;
      background: linear-gradient(90deg, #ff3b30, #ff9d00) !important;
      margin-right: 8px !important;
      vertical-align: middle !important;
    }

    .pcspotrow {
      display: grid !important;
      grid-template-columns: 95px 1fr 160px !important;
      gap: 14px !important;
      align-items: center !important;
      padding: 14px !important;
      border-bottom: 1px solid rgba(255,255,255,.07) !important;
    }

    .pcspotrow.on {
      border: 1px solid rgba(255,132,0,.75) !important;
      background: rgba(255,132,0,.08) !important;
      box-shadow: inset 0 0 18px rgba(255,132,0,.12) !important;
    }

    .pcspotleft b {
      color: #ff9d00 !important;
      font-size: 22px !important;
      display: block !important;
    }

    .pcspotleft span,
    .pcspotright span,
    .pcspotbars label {
      color: #aeb7c7 !important;
      font-size: 12px !important;
    }

    .pcspotbars {
      display: grid !important;
      gap: 9px !important;
    }

    .pcspotbars div {
      display: grid !important;
      gap: 5px !important;
    }

    .pcspotbars i {
      display: block !important;
      height: 10px !important;
      border-radius: 999px !important;
    }

    .opsbar {
      background: linear-gradient(90deg, #ff4d00, #ffd21f) !important;
    }

    .hrbar {
      background: linear-gradient(90deg, #15b84a, #7cff35) !important;
    }

    .pcspotright {
      display: grid !important;
      gap: 5px !important;
      text-align: right !important;
    }
  `;

  const style = document.createElement("style");
  style.id = "slip-lab-pitch-spot-polish";
  style.textContent = css;
  document.head.appendChild(style);
})();
