(() => {
  let PLAYERS = [];
  let SPRAY = {};
  let ZONES = {};
  let CARD_DATA = {};
  let PITCH_DAMAGE = {};
  let ATTACK_ZONES = {};
  let SPOT_DATA = {};
  let HR_AI = {};
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

    const merged = {
      ...found,
      cardData: extra,
      aiBreakdown: aiFor(found),
      last7: extra.last7 || found.last7,
      last15: extra.last15 || found.last15,
      gameLogs: extra.gameLogs || found.gameLogs,
      enrichedTags: extra.tags || found.enrichedTags,
      season: extra.season || found.season
    };

    const rank = Number(merged.modelRank || merged.rank || 0);
    const sharedTags = window.SlipLabTags && typeof window.SlipLabTags.build === "function"
      ? window.SlipLabTags.build(merged, merged, rank)
      : (Array.isArray(merged.tags) ? merged.tags : []);

    return enrich({
      ...merged,
      tags: sharedTags,
      badges: sharedTags,
      enrichedTags: sharedTags
    });
  }

  function zoneIcon(title) {
    if (title === "AVG") return "▥";
    if (title === "ISO") return "⌖";
    if (title === "SLG") return "◒";
    if (title === "HR") return "⬡";
    if (title === "Pitcher Leak") return "♨";
    if (title === "Pitcher Attack Zones") return "⌾";
    if (title === "Zone Overlap") return "◎";
    return "◆";
  }

  function zoneSub(title) {
    if (title === "AVG") return "Batting average";
    if (title === "ISO") return "Isolated power";
    if (title === "SLG") return "Slugging damage";
    if (title === "HR") return "Home run zones";
    if (title === "Pitcher Leak") return "Where pitcher gives up damage";
    if (title === "Pitcher Attack Zones") return "Where pitcher attacks the zone";
    if (title === "Zone Overlap") return "Hitter vs pitcher matchup";
    return "Zone profile";
  }

  function zones(title, values, field, mode) {
    const cells = Array.isArray(values) ? values.slice(0, 25) : Array.from({ length: 25 }, () => 0);
    const primary = title === "Zone Overlap";
    const pitcher = title === "Pitcher Leak";

    return `<section class="pcz pcz-clean ${primary ? "pcz-primary" : ""} ${pitcher ? "pcz-pitcher" : ""}">
      <header class="pcz-clean-head">
        <span class="pcz-clean-icon">${zoneIcon ? zoneIcon(title) : "◆"}</span>
        <span class="pcz-clean-copy">
          <b>${esc(title)}</b>
          <small>${zoneSub ? esc(zoneSub(title)) : "Zone profile"}</small>
        </span>
      </header>

      <main class="pcz-clean-board">
        ${cells.map(cell => {
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
            cls = score >= 75 ? "zdanger" : score >= 55 ? "z5" : score >= 35 ? "z4" : score >= 18 ? "z3" : score >= 5 ? "z2" : "z1";
          }

          const txt = mode === "dec" ? dec(raw) : String(Math.round(n));
          return `<span class="${cls}" title="${esc(title)}: ${esc(txt)}">${txt}</span>`;
        }).join("")}
      </main>

      <footer class="pcz-clean-axis">
        <span>Inside</span><span>Middle</span><span>Outside</span>
      </footer>
    </section>`;
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

  function hasPlatoonAdvantage(row) {
    const batter = String(row.batSide || row.bats || "").trim().toUpperCase();
    const pitcher = String(row.opposingPitcherHand || row.pitcherHand || "").trim().toUpperCase();
    const isRightBatter = batter === "R" || batter === "RH" || batter === "RHB" || batter.includes("RIGHT");
    const isLeftBatter = batter === "L" || batter === "LH" || batter === "LHB" || batter.includes("LEFT");
    const isLeftPitcher = pitcher === "L" || pitcher === "LH" || pitcher === "LHP" || pitcher.includes("LEFT");
    const isRightPitcher = pitcher === "R" || pitcher === "RH" || pitcher === "RHP" || pitcher.includes("RIGHT");
    return (isRightBatter && isLeftPitcher) || (isLeftBatter && isRightPitcher);
  }

  function isConfirmedLineupPlayer(row) {
    const status = String(row.lineupStatus || "").trim().toUpperCase();
    const source = String(row.lineupSource || "").trim().toUpperCase();
    return ![status, source].some(value => ["NOT IN LINEUP", "NOT_IN_LINEUP", "BENCH", "NOT STARTING", "NOT_STARTING"].includes(value));
  }

  function chips(row) {
    const h = stats(row);
    const out = [grade(row)];

    const add = (label) => {
      const value = String(label || "").trim();
      if (!value) return;
      if (!out.some(x => String(x).toUpperCase() === value.toUpperCase())) out.push(value);
    };

    if (row.confirmedLineup && row.lineupSpot) add("CONFIRMED #" + row.lineupSpot);
    else if (row.lineupSpot) add("PROJECTED #" + row.lineupSpot);

    if (row.lineupRole) add(row.lineupRole);
    if (num(row.lineupBoost) >= 8) add("LINEUP BOOST");

    if (Array.isArray(row.tags)) {
      row.tags.forEach(add);
    }

    if (num(h.HR) >= 10) add(`${h.HR} HR`);
    if (num(h.SLG) >= .500) add("POWER");
    if (num(h.OPS) >= .850) add("OPS HEATER");
    if (num(row.hotZoneCount) >= 4) add("HOT ZONES");
    if (num(row.hitterZonePower) >= 50) add("ZONE EDGE");
    if (num(row.weather) > 0) add("WEATHER");
    if (num(row.bullpen) > 0) add("BULLPEN");
    if (num(row.pitcherRisk) >= 70) add("HR LEAK");
    if (num(row.zoneOverlap) >= 55) add("ZONE OVERLAP");
    if (num(row.powerScore) >= 70) add("BARREL KING");
    if (num(row.protectionScore) >= 75) add("PROTECTION BOOST");
    if (hasPlatoonAdvantage(row)) add("PLATOON ADVANTAGE");

    const priority = [
      "TOP 10",
      "TOP 30",
      "IF ONLY ONE",
      "BEST PICK",
      "DANGER",
      "STRONG",
      "POWER BAT",
      "POWER ZONE",
      "PITCH EDGE",
      "PITCH TYPE EDGE",
      "ZONE 5+",
      "WEATHER CARRY",
      "BULLPEN BOOST",
      "BEST VALUE",
      "LOTTO BOMB",
      "HR LEAK",
      "ZONE OVERLAP",
      "LINEUP BOOST"
    ];

    const ordered = out.sort((a, b) => {
      const aa = priority.indexOf(String(a).toUpperCase());
      const bb = priority.indexOf(String(b).toUpperCase());
      return (aa === -1 ? 999 : aa) - (bb === -1 ? 999 : bb);
    });

    const chipClass = label => {
      const t = String(label || "").toUpperCase();
      if (t.includes("TOP 10") || t.includes("TOP 30")) return "pcchip pcchip-top";
      if (t.includes("IF ONLY ONE") || t.includes("BEST PICK")) return "pcchip pcchip-gold";
      if (t.includes("DANGER") || t.includes("LEAK")) return "pcchip pcchip-danger";
      if (t.includes("STRONG") || t.includes("ELITE")) return "pcchip pcchip-strong";
      if (t.includes("POWER")) return "pcchip pcchip-power";
      if (t.includes("PLATOON")) return "pcchip pcchip-split";
      if (t.includes("PITCH")) return "pcchip pcchip-pitch";
      if (t.includes("ZONE") || t.includes("OVERLAP")) return "pcchip pcchip-zone";
      if (t.includes("WEATHER")) return "pcchip pcchip-weather";
      if (t.includes("BULLPEN")) return "pcchip pcchip-bullpen";
      if (t.includes("VALUE")) return "pcchip pcchip-value";
      if (t.includes("LOTTO")) return "pcchip pcchip-lotto";
      return "pcchip pcchip-base";
    };

    return ordered.slice(0, 22).map(x => `<span class="${chipClass(x)}">${esc(x)}</span>`).join("");
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

  function verdictTier(row) {
    const strength = edgeStrength(row);
    const chance = hrChance(row);
    const score = num(row.hrConfidence || row.score || row.truePowerScore);

    if (strength >= 8.5 || chance >= 24 || score >= 90) return { label: "Green Light", cls: "green" };
    if (strength >= 7 || chance >= 18 || score >= 75) return { label: "Strong Look", cls: "strong" };
    if (strength >= 5.5 || chance >= 13 || score >= 58) return { label: "Live Bat", cls: "live" };
    return { label: "Watch Only", cls: "watch" };
  }

  function renderParkAttackProfile(row) {
    const venue = row.venue || row.ballpark || "Ballpark";
    const pull = row.pullSideField || (String(row.batSide || row.bats || "").toUpperCase().startsWith("L") ? "RF" : "LF");
    const weatherScore = num(row.pullWindHrScore || row.weather || row.hrEnvironmentScore);
    const tag = row.pullWindHrTag || row.weatherTag || "Park Context";

    const lane =
      weatherScore >= 60 ? "Elite Carry Lane" :
      weatherScore >= 35 ? "Playable Carry Lane" :
      weatherScore >= 15 ? "Small Carry Edge" :
      "Neutral Park Lane";

    return `
      <section class="pcpark-profile">
        <div class="pcsection-head">
          <div>
            <h3>Park Attack Profile</h3>
            <p>How the ballpark and pull lane fit this hitter today</p>
          </div>
          <span>${esc(tag)}</span>
        </div>

        <div class="pcpark-grid">
          <div class="pcpark-main">
            <span>Best Lane</span>
            <strong>${esc(pull)}</strong>
            <em>${esc(lane)}</em>
          </div>

          <div class="pcpark-card">
            <span>Venue</span>
            <strong>${esc(venue)}</strong>
          </div>

          <div class="pcpark-card">
            <span>Carry Score</span>
            <strong>${one(weatherScore)}</strong>
          </div>
        </div>

        <div class="pcpark-note">
          ${weatherScore >= 35
            ? `${esc(venue)} is giving this hitter a usable pull side carry path toward ${esc(pull)}.`
            : `${esc(venue)} is not carrying the HR case by itself, so the play needs support from power, pitch edge, or zone overlap.`}
        </div>
      </section>
    `;
  }

  function renderBullpenRiskSnapshot(row) {
    const score = num(row.bullpenInheritanceScore || row.bullpen);
    const bonus = num(row.bullpenInheritanceBonus);
    const tag = row.bullpenInheritanceTag || bullpenTag(score);

    const tier =
      score >= 75 ? "Major Late HR Risk" :
      score >= 60 ? "Danger Bullpen" :
      score >= 42 ? "Playable Late Boost" :
      "Stable";

    return `
      <section class="pcbp-snapshot">
        <div class="pcsection-head">
          <div>
            <h3>Bullpen HR Risk</h3>
            <p>Late game upside if this bat gets bullpen plate appearances</p>
          </div>
          <span>${esc(tag)}</span>
        </div>

        <div class="pcbp-snapshot-grid">
          <div class="pcbp-risk-main">
            <span>Late HR Risk</span>
            <strong>${one(score)}</strong>
            <em>${esc(tier)}</em>
          </div>

          <div class="pcbp-risk-card">
            <span>Boost</span>
            <strong>${one(bonus)}</strong>
          </div>

          <div class="pcbp-risk-card">
            <span>Opponent</span>
            <strong>${esc(row.opponent || "N/A")}</strong>
          </div>
        </div>

        <div class="pcbp-risk-note">
          ${score >= 60
            ? "The bullpen layer is adding real late game HR upside to this profile."
            : score >= 42
              ? "The bullpen layer is playable, but not the main reason for the HR case."
              : "Bullpen risk is not carrying this profile right now."}
        </div>
      </section>
    `;
  }

  function renderDecisionVerdict(row) {
    const verdict = verdictTier(row);
    const h = stats(row);

    const checks = [
      ["Power", num(h.SLG) >= .500 || num(row.truePowerScore || row.powerScore) >= 70],
      ["Pitch Edge", num(row.pitchTypeDestructionScore) >= 60],
      ["Zone Edge", num(row.zoneOverlap || row.hotZoneCount) > 0],
      ["Weather", num(row.pullWindHrScore || row.weather) > 0],
      ["Bullpen", num(row.bullpenInheritanceScore || row.bullpen) > 0],
      ["Recent", num(row.recentHRTrend) > 0 || num(row.multiHrCeilingScore) >= 65]
    ];

    return `
      <section class="pcverdict ${verdict.cls}">
        <div class="pcverdict-top">
          <div>
            <span>Decision Verdict</span>
            <h3>${esc(verdict.label)}</h3>
            <p>${esc(row.note || whyText(row))}</p>
          </div>
          <div class="pcverdict-score">
            <strong>${one(edgeStrength(row))}</strong>
            <small>Case Strength</small>
          </div>
        </div>

        <div class="pcverdict-checks">
          ${checks.map(([label, on]) => `
            <div class="pcverdict-check ${on ? "on" : ""}">
              <b>${on ? "✓" : "•"}</b>
              <span>${esc(label)}</span>
            </div>
          `).join("")}
        </div>
      </section>
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

    return Array.from({ length: 25 }, (_, i) => {
      const cell = raw[i] || {};
      const qualified = cell.qualified === true && cell.danger !== null && cell.danger !== undefined;
      const hitter = qualified ? num(cell.hitterXwoba) * 100 : 0;
      const pitcher = qualified ? num(cell.pitcherXwobaAllowed) * 100 : 0;
      const overlap = qualified ? num(cell.danger) : 0;
      const value = Math.max(hitter, pitcher, overlap);

      return {
        hitter,
        pitcher,
        overlap,
        value,
        qualified
      };
    });
  }

  function renderZoneOverlapCard(row) {
    const overlap = Math.max(
      num(row.zoneOverlap),
      num(row.hotZoneCount),
      num(row.hitterZonePower) / 12
    );

    const label = overlap >= 7 ? "ELITE" : overlap >= 5 ? "STRONG" : overlap >= 3 ? "LIVE" : "BUILDING";

    return `
      <div class="pcoverlap-card pcoverlap-premium">
        <span>PRIMARY MATCHUP ZONE</span>
        <strong>${one(overlap)}</strong>
        <em>${label}</em>
        <small>ZONE OVERLAP SCORE</small>
      </div>
    `;
  }


  function zoneMatchSummary(row) {
    const overlap = Math.max(
      num(row.zoneOverlap),
      num(row.hotZoneCount),
      num(row.hitterZonePower) / 12
    );

    const matchCount = Math.max(0, Math.min(5, Math.round(overlap)));
    const spray =
      row.sprayTendency ||
      row.pullTendency ||
      row.battedBallProfile ||
      row.hitDirection ||
      "Balanced";

    const label =
      matchCount >= 5 ? "Premium overlap" :
      matchCount >= 4 ? "Strong overlap" :
      matchCount >= 3 ? "Playable overlap" :
      matchCount >= 2 ? "Some overlap" :
      "Low overlap";

    return `
      <div class="pczone-summary">
        <div>
          <span>Hot Zone Match</span>
          <strong>${matchCount}/5</strong>
          <em>${label}</em>
        </div>
        <div>
          <span>Spray Profile</span>
          <strong>${esc(spray)}</strong>
          <em>Direction context</em>
        </div>
        <div>
          <span>Read</span>
          <strong>${matchCount >= 4 ? "Attackable" : matchCount >= 3 ? "Live" : "Monitor"}</strong>
          <em>Use with pitch type and lineup spot</em>
        </div>
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


  function aiFor(row) {
    const players = HR_AI?.players || {};
    return players[String(row.playerId || "")] ||
      players[row.player] ||
      players[key(row.player)] ||
      null;
  }

  function aiReasonIcon(reason) {
    const r = key(reason);
    if (r.includes("confidence")) return "📈";
    if (r.includes("power")) return "⚡";
    if (r.includes("pitcher")) return "🎯";
    if (r.includes("weather") || r.includes("carry")) return "🌪";
    if (r.includes("bullpen")) return "🔥";
    if (r.includes("pitch-type") || r.includes("arsenal")) return "🧬";
    if (r.includes("launch")) return "🚀";
    if (r.includes("ballpark")) return "🏟";
    return "✓";
  }

  function renderAiBreakdown(row) {
    const ai = aiFor(row);
    if (!ai?.summary) return "";

    const reasons = Array.isArray(ai.reasons) ? ai.reasons.slice(0, 6) : [];
    const grade = ai.grade || "A";
    const spot =
      grade === "A+" ? "Elite HR Spot" :
      grade === "A" ? "Strong HR Spot" :
      grade === "B+" ? "Live HR Spot" :
      "Model Watch";

    return `
      <section class="pcai-card">
        <div class="pcai-glow"></div>
        <div class="pcsection-head pcai-head">
          <div>
            <h3>🧠 Slip Lab AI Breakdown</h3>
            <p>Model-generated explanation built from today’s HR inputs</p>
          </div>
          <span class="pcai-grade">${esc(grade)} · ${esc(spot)}</span>
        </div>

        <p class="pcai-summary">${esc(ai.summary)}</p>

        ${reasons.length ? `
          <div class="pcai-reasons">
            ${reasons.map(r => `<span>${aiReasonIcon(r)} ${esc(r)}</span>`).join("")}
          </div>
        ` : ""}
      </section>
    `;
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
    return zones(title, cells, null, mode);
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

  function renderPitcherVulnerabilityProfile(row) {
    const cells = attackCellsFor(row);
    const damage = pitchDamageFor(row);
    const pitchRows = Object.values(damage || {});

    const avgDanger = cells.length
      ? cells.reduce((sum, c) => sum + num(c.pitcher), 0) / cells.length
      : 0;

    const hottestZones = cells
      .map((c, i) => ({ zone: i + 1, danger: num(c.pitcher) }))
      .sort((a, b) => b.danger - a.danger)
      .slice(0, 4);

    const bestPitch = pitchRows
      .slice()
      .sort((a, b) => num(b.crush || b.slg || b.hr) - num(a.crush || a.slg || a.hr))[0];

    const profile =
      avgDanger >= 80 ? "Major Leak" :
      avgDanger >= 65 ? "Attackable" :
      avgDanger >= 50 ? "Playable" :
      "Stable";

    return `
      <section class="pcvuln">
        <div class="pcsection-head">
          <div>
            <h3>Pitcher Vulnerability Profile</h3>
            <p>Where this pitcher is most attackable for HR damage</p>
          </div>
          <span>${esc(profile)}</span>
        </div>

        <div class="pcvuln-grid">
          <div class="pcvuln-card main">
            <span>Pitcher Leak</span>
            <strong>${one(avgDanger)}</strong>
            <em>${esc(profile)}</em>
          </div>

          <div class="pcvuln-card">
            <span>Best Pitch To Attack</span>
            <strong>${esc(bestPitch?.label || row.bestPitch || row.pitchTypeDestructionPitch || "N/A")}</strong>
            <em>${one(row.pitchTypeDestructionScore)}</em>
          </div>

          <div class="pcvuln-card">
            <span>Highest Leak Zone</span>
            <strong>Zone ${hottestZones[0]?.zone || "N/A"}</strong>
            <em>${one(hottestZones[0]?.danger)}</em>
          </div>
        </div>

        <div class="pcvuln-zones">
          ${hottestZones.map(z => `
            <div class="pcvuln-zone">
              <b>Zone ${z.zone}</b>
              <span>${one(z.danger)}</span>
            </div>
          `).join("")}
        </div>

        <div class="pcvuln-note">
          ${esc(row.opposingPitcher || "This pitcher")} is showing the most HR vulnerability in the highest danger zones above. Pair this with the hitter ISO, SLG, and overlap grids before making the final call.
        </div>
      </section>
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
      ${renderPitcherVulnerabilityProfile(row)}

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

    const confirmedSpot =
      row.confirmedLineupSpot ||
      row.actualLineupSpot ||
      row.battingOrder ||
      row.lineupSpot ||
      null;

    const projectedSpot =
      row.projectedLineupSpot ||
      row.projectedSpot ||
      spot?.projectedSpot ||
      null;

    const activeSpot = confirmedSpot || projectedSpot;
    const isConfirmed = Boolean(confirmedSpot || row.confirmedLineup || String(row.lineupSource || "").toUpperCase() === "CONFIRMED");

    const lineupRole = row.lineupRole || "";
    const lineupBoost = num(row.lineupBoost);
    const projectedPA = num(row.projectedPlateAppearances);
    const protectionScore = num(row.protectionScore);

    if (!spot?.spots) {
      return `
        <h3>Spot Lab</h3>
        <div class="pcgrid">
          ${metric(isConfirmed ? "Confirmed Spot" : "Projected Spot", activeSpot ? "#" + activeSpot : "Pending")}
          ${metric("Lineup Role", lineupRole || (isConfirmed ? "Confirmed" : "Pending"))}
          ${metric("PA Projection", projectedPA ? projectedPA.toFixed(2) : "Pending")}
          ${metric("Lineup Boost", lineupBoost ? (lineupBoost >= 0 ? "+" : "") + lineupBoost.toFixed(1) : "0.0")}
          ${metric("Protection", protectionScore ? protectionScore.toFixed(1) : "Pending")}
        </div>
        <div class="pcwhy">Batting spot history is building for this player.</div>
      `;
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
        <span>${isConfirmed ? "Confirmed" : "Projected"} #${esc(activeSpot || "-")}</span>
      </div>

      <div class="pcgrid">
        ${metric(isConfirmed ? "Confirmed Spot" : "Projected Spot", activeSpot ? "#" + activeSpot : "Pending")}
        ${metric("Best Spot", "#" + spot.bestSpot)}
        ${metric("Worst Spot", "#" + spot.worstSpot)}
        ${metric("Lineup Role", lineupRole || (isConfirmed ? "Confirmed" : "Pending"))}
        ${metric("PA Projection", projectedPA ? projectedPA.toFixed(2) : "Pending")}
        ${metric("Lineup Boost", lineupBoost ? (lineupBoost >= 0 ? "+" : "") + lineupBoost.toFixed(1) : "0.0")}
        ${metric("Protection", protectionScore ? protectionScore.toFixed(1) : "Pending")}
      </div>

      <div class="pcspottable">
        ${rows.map(r => {
          const current = Number(r.lineupSpot) === Number(activeSpot);
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
        ${tabButton("Why", "why")}
        ${tabButton("Recent", "recent")}
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

  function playerInitials(name) {
    return String(name || "")
      .trim()
      .split(/\s+/)
      .map(part => part[0] || "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  function playerHeadshot(row) {
    const id = String(row.playerId || "").replace(/\D/g, "");
    const fallback = `<span class="pc-headshot-fallback" aria-hidden="true">${esc(playerInitials(row.player))}</span>`;
    if (!id) return `<div class="pc-headshot">${fallback}</div>`;
    const src = `https://img.mlbstatic.com/mlb-photos/image/upload/w_180,q_auto:best,f_auto/v1/people/${id}/headshot/67/current`;
    return `<div class="pc-headshot">${fallback}<img src="${src}" alt="${esc(row.player)} headshot" loading="lazy" onerror="this.remove()"></div>`;
  }

  function renderHero(row) {
    const h = stats(row);
    const conf = hrChance(row);
    const prob = Math.max(3, Math.min(25, conf / 4));
    const theme = pcTheme(row);

    return `
      <div class="pcheader pctheme-${theme}">
        <div class="pc-hero-player">
          ${playerHeadshot(row)}
          <div class="pc-hero-copy">
            <h2>${esc(row.player)}</h2>
            <p>${esc(row.team)} vs ${esc(row.opponent)}${row.opposingPitcher ? " • vs " + esc(row.opposingPitcher) : ""}</p>
            <div class="pcchips">${chips(row)}</div>
          </div>
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

      ${renderMatchupRead(row)}

      ${renderDecisionVerdict(row)}
      ${renderBullpenRiskSnapshot(row)}
      ${renderParkAttackProfile(row)}
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

  function handLabel(value, role) {
    const hand = String(value || "").trim().toUpperCase();
    if (role === "batter") return hand === "L" || hand === "LHB" ? "LHB" : hand === "R" || hand === "RHB" ? "RHB" : hand === "S" || hand === "SHB" || hand === "B" ? "SHB" : "—";
    return hand === "L" || hand === "LHP" ? "vs LHP" : hand === "R" || hand === "RHP" ? "vs RHP" : "vs —";
  }

  function splitLine(label, split) {
    if (!split || !num(split.pa)) return `<div class="pcmatch-split"><span>${esc(label)}</span><b>—</b><small>No season sample</small></div>`;
    return `<div class="pcmatch-split"><span>${esc(label)}</span><b>${dec(split.avg)} / ${dec(split.ops)}</b><small>AVG / OPS · ${esc(split.pa)} PA · ${esc(split.hr)} HR</small></div>`;
  }

  function renderMatchupRead(row) {
    const splits = row.splits || {};
    return `
      <section class="pcmatch-read" aria-label="Matchup Read">
        <div class="pcmatch-head"><strong>Matchup Read</strong><span>${handLabel(row.batSide || row.bats, "batter")} · ${handLabel(row.opposingPitcherHand || row.pitcherHand, "pitcher")}</span></div>
        <div class="pcmatch-grid">
          ${splitLine("vs LHP", splits.vsLhp)}
          ${splitLine("vs RHP", splits.vsRhp)}
          ${splitLine("Day", splits.day)}
          ${splitLine("Night", splits.night)}
        </div>
      </section>`;
  }

  function renderTab(id, row) {
    const body = document.getElementById("pcTabBody");
    if (!body) return;

    document.querySelectorAll(".pctab").forEach(btn => btn.classList.toggle("on", btn.dataset.tab === id));

    const h = stats(row);

    if (id === "why") {
      body.innerHTML = renderWhyTab(row);
      return;
    }

    if (id === "recent") {
      body.innerHTML = renderRecentFormTab(row);
      return;
    }

    if (id === "zones") {
      body.innerHTML = `
        <div class="pczone-header-compact">
          <div class="pczone-header-copy">
            <h3>Zone matchup map</h3>
            <div class="pczone-matchup-tag">Live hitter–pitcher overlap</div>
            <p>See where the hitter creates damage and where the opposing pitcher allows it.</p>
            <div class="pczone-legend-explained">
              <div class="leg-row cold"><span class="leg-chip">Cold</span><small>Low Damage</small></div>
              <div class="leg-row neutral"><span class="leg-chip">Neutral</span><small>Average</small></div>
              <div class="leg-row warm"><span class="leg-chip">Warm</span><small>Above Average</small></div>
              <div class="leg-row hot"><span class="leg-chip">Hot</span><small>Strong Damage</small></div>
              <div class="leg-row nuclear"><span class="leg-chip">Nuclear</span><small>Elite Damage Zone</small></div>
            </div>
          </div>

          <div class="pczone-score-card">
            <strong>${one(Math.max(num(row.zoneOverlap), num(row.hotZoneCount), num(row.hitterZonePower) / 12))}</strong>
            <span>Overlap index</span>
          </div>
        </div>

        <div class="pczone-grid-upgraded pczone-grid-premium">
          ${zones("Zone Overlap", attackCellsFor(row), "overlap")}
          ${zones("Pitcher Leak", attackCellsFor(row), "pitcher")}
          ${zones("AVG", row.avgZones, null, "dec")}
          ${zones("ISO", row.isoZones, null, "dec")}
          ${zones("SLG", row.slgZones, null, "dec")}
          ${zones("HR", row.hrZones, null, "cnt")}
        </div>
      `;
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
      body.innerHTML = `<h3>Splits</h3>${renderMatchupRead(row)}`;
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
      .pc-hero-player{display:flex;align-items:flex-start;gap:12px;min-width:0}
      .pc-hero-copy{min-width:0}
      .pc-headshot{position:relative;flex:0 0 58px;width:58px;height:58px;overflow:hidden;border:1px solid rgba(255,255,255,.2);border-radius:50%;background:#182329;display:grid;place-items:center;box-shadow:0 7px 20px rgba(0,0,0,.24)}
      .pc-headshot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top}
      .pc-headshot-fallback{font-size:17px;font-weight:950;color:#e8edf5}
      .pcprob{width:110px;height:84px;border-radius:16px;border:1px solid rgba(255,116,72,.55);display:flex;flex-direction:column;justify-content:center;align-items:center;background:rgba(0,0,0,.25)}
      .pcprob b{font-size:28px;color:#ff8a00}
      .pcprob span{font-size:10px;color:#aeb6c2;text-transform:uppercase;font-weight:900}
      .pcchips{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px;max-width:980px}
      .pcchip{
        border-radius:8px;
        padding:5px 8px;
        font-size:9px;
        font-weight:1000;
        letter-spacing:.02em;
        text-transform:uppercase;
        border:1px solid rgba(255,255,255,.20);
        background:rgba(255,255,255,.07);
        color:#fff;
        box-shadow:0 0 10px rgba(255,255,255,.05);
      }
      .pcchip-top{color:#ffe66d;border-color:#ffd000;background:rgba(255,208,0,.13);box-shadow:0 0 18px rgba(255,208,0,.42), inset 0 0 12px rgba(255,208,0,.10)}
      .pcchip-gold{color:#fff2a8;border-color:#ffc400;background:rgba(255,196,0,.16);box-shadow:0 0 20px rgba(255,196,0,.45), inset 0 0 14px rgba(255,196,0,.12)}
      .pcchip-danger{color:#ff79c8;border-color:#ff3fb4;background:rgba(255,63,180,.14);box-shadow:0 0 18px rgba(255,63,180,.38), inset 0 0 12px rgba(255,63,180,.10)}
      .pcchip-strong{color:#00f0a8;border-color:#00d084;background:rgba(0,208,132,.14);box-shadow:0 0 16px rgba(0,208,132,.34)}
      .pcchip-power{color:#ff6b5f;border-color:#ff342a;background:rgba(255,52,42,.14);box-shadow:0 0 18px rgba(255,52,42,.38)}
      .pcchip-split{color:#d9b8ff;border-color:#b36cff;background:rgba(179,108,255,.18);box-shadow:0 0 16px rgba(179,108,255,.24)}
      .pcchip-pitch{color:#20e7ff;border-color:#00cfff;background:rgba(0,207,255,.14);box-shadow:0 0 16px rgba(0,207,255,.35)}
      .pcchip-zone{color:#ff9d2e;border-color:#ff7a00;background:rgba(255,122,0,.15);box-shadow:0 0 16px rgba(255,122,0,.35)}
      .pcchip-weather{color:#54c7ff;border-color:#2196ff;background:rgba(33,150,255,.14);box-shadow:0 0 16px rgba(33,150,255,.34)}
      .pcchip-bullpen{color:#c084ff;border-color:#a855f7;background:rgba(168,85,247,.15);box-shadow:0 0 16px rgba(168,85,247,.35)}
      .pcchip-value{color:#7cff6b;border-color:#6ee75f;background:rgba(110,231,95,.13);box-shadow:0 0 14px rgba(110,231,95,.30)}
      .pcchip-lotto{color:#ffb86c;border-color:#ff8a00;background:rgba(255,138,0,.15);box-shadow:0 0 16px rgba(255,138,0,.34)}
      .pcchip-base{color:#e8edf5;border-color:rgba(255,255,255,.20);background:rgba(255,255,255,.075)}
      .pcbiggrid,.pcgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
      .pcmatch-read{margin:10px 0;padding:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;background:rgba(255,255,255,.035)}
      .pcmatch-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
      .pcmatch-head strong{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#fff}
      .pcmatch-head span{font-size:11px;font-weight:950;color:#93ff2d}
      .pcmatch-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
      .pcmatch-split{padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(0,0,0,.18)}
      .pcmatch-split span,.pcmatch-split small{display:block;color:#8e98a3;font-size:9px;font-weight:900}
      .pcmatch-split span{text-transform:uppercase}
      .pcmatch-split b{display:block;margin:4px 0 3px;color:#fff;font-size:14px}
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


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

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


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

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


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

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


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

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


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

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


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

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


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

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


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pczone-hero,.pczone-grid-upgraded{grid-template-columns:1fr}}


      .pcpitch-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pcpitch-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
      .pcpitch-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#aeb6c2;font-weight:900}
      .pcpitch-card strong{display:block;margin-top:6px;font-size:18px;color:#fff}
      .pcpitch-card.hot{border-color:rgba(255,122,35,.30);background:rgba(255,122,35,.08)}
      .pcpitch-card.hot strong{color:#ff9b2f}

      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcpitch-summary{grid-template-columns:repeat(2,1fr)}}


      .pcrecent-note{margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.04);padding:12px;color:#d8dee6;font-size:13px;line-height:1.4}


      .pcverdict{margin:12px 0;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025))}
      .pcverdict.green{border-color:rgba(140,255,50,.30);background:linear-gradient(135deg,rgba(140,255,50,.12),rgba(0,224,164,.04))}
      .pcverdict.strong{border-color:rgba(255,176,0,.30);background:linear-gradient(135deg,rgba(255,176,0,.12),rgba(255,122,35,.04))}
      .pcverdict.live{border-color:rgba(0,224,255,.24);background:linear-gradient(135deg,rgba(0,224,255,.08),rgba(255,255,255,.03))}
      .pcverdict-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .pcverdict-top span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcverdict-top h3{margin:5px 0 7px!important;color:#fff!important;font-size:22px!important;text-transform:none!important;letter-spacing:0!important}
      .pcverdict-top p{margin:0!important;color:#d8dee6!important;line-height:1.4!important}
      .pcverdict-score{min-width:96px;text-align:center;border:1px solid rgba(255,255,255,.13);border-radius:15px;background:rgba(0,0,0,.22);padding:12px}
      .pcverdict-score strong{display:block;color:#8cff32;font-size:34px;line-height:1}
      .pcverdict-score small{display:block;margin-top:6px;color:#aeb6c2;font-size:10px;text-transform:uppercase;font-weight:900}
      .pcverdict-checks{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:13px}
      .pcverdict-check{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.04);padding:8px 7px;color:#9aa6ad;font-size:11px;font-weight:900}
      .pcverdict-check.on{color:#fff;border-color:rgba(140,255,50,.20);background:rgba(140,255,50,.07)}
      .pcverdict-check b{color:#8cff32}

      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcverdict-top{flex-direction:column}.pcverdict-score{width:100%}.pcverdict-checks{grid-template-columns:repeat(2,1fr)}}


      .pcvuln{margin:12px 0;border:1px solid rgba(255,122,35,.22);border-radius:16px;background:linear-gradient(135deg,rgba(255,122,35,.08),rgba(255,255,255,.025));padding:12px}
      .pcvuln-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;margin-bottom:10px}
      .pcvuln-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcvuln-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcvuln-card strong{display:block;margin-top:6px;color:#fff;font-size:19px}
      .pcvuln-card em{display:inline-block;margin-top:7px;font-style:normal;color:#ff9b2f;font-size:11px;font-weight:950}
      .pcvuln-card.main strong{color:#ff9b2f;font-size:30px;line-height:1}
      .pcvuln-zones{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
      .pcvuln-zone{display:flex;justify-content:space-between;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);padding:8px 9px}
      .pcvuln-zone b{color:#fff;font-size:12px}
      .pcvuln-zone span{color:#8cff32;font-weight:950}
      .pcvuln-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcvuln-grid,.pcvuln-zones{grid-template-columns:1fr}}


      .pcbp-snapshot{margin:12px 0;border:1px solid rgba(0,224,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(0,224,255,.07),rgba(255,255,255,.025));padding:12px}
      .pcbp-snapshot-grid{display:grid;grid-template-columns:1.2fr .7fr 1fr;gap:8px}
      .pcbp-risk-main,.pcbp-risk-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcbp-risk-main span,.pcbp-risk-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcbp-risk-main strong{display:block;margin-top:6px;color:#00e0ff;font-size:32px;line-height:1}
      .pcbp-risk-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcbp-risk-card strong{display:block;margin-top:6px;color:#fff;font-size:18px}
      .pcbp-risk-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}

      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){.pcbp-snapshot-grid{grid-template-columns:1fr}}


      .pcpark-profile{margin:12px 0;border:1px solid rgba(140,255,50,.18);border-radius:16px;background:linear-gradient(135deg,rgba(140,255,50,.07),rgba(255,255,255,.025));padding:12px}
      .pcpark-grid{display:grid;grid-template-columns:1fr 1.1fr .8fr;gap:8px}
      .pcpark-main,.pcpark-card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(0,0,0,.18);padding:12px}
      .pcpark-main span,.pcpark-card span{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6c2;font-weight:950}
      .pcpark-main strong{display:block;margin-top:6px;color:#8cff32;font-size:32px;line-height:1}
      .pcpark-main em{display:inline-block;margin-top:7px;font-style:normal;color:#d8dee6;font-size:11px;font-weight:950}
      .pcpark-card strong{display:block;margin-top:6px;color:#fff;font-size:17px;line-height:1.15}
      .pcpark-note{margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px;color:#d8dee6;font-size:12px;line-height:1.4}
      @media(max-width:850px){.pcpark-grid{grid-template-columns:1fr}}

      @media(max-width:850px){#pcBox{max-width:94vw}.pcheader{gap:10px}.pc-headshot{flex-basis:50px;width:50px;height:50px}.pcbiggrid,.pcgrid,.pcbars,.pcprofile,.pcmatch-grid{grid-template-columns:repeat(2,1fr)}.pczones{grid-template-columns:repeat(2,max-content)}.pcl7hero{grid-template-columns:repeat(2,1fr)}}
    `;
    document.head.appendChild(style);
  }

  async function boot() {
    css();

    const decision = await getJSON("./data/hr_decision_center.json", {});
    HR_AI = await getJSON("./data/hr_ai_breakdowns.json", { players: {} });
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

    PLAYERS = [...map.values()].filter(isConfirmedLineupPlayer);

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

/* Editorial MLB player-card shell. Scoped so deferred sport pages keep their current cards. */
(function(){
  if (!document.body.classList.contains("tsl-editorial") || document.getElementById("pcEditorialCss")) return;
  const s = document.createElement("style");
  s.id = "pcEditorialCss";
  s.textContent = `
    body.tsl-editorial #pcFull{background:rgba(7,29,54,.78)!important}
    body.tsl-editorial #pcBox{max-width:1040px!important;border:1px solid #071d36!important;border-radius:0!important;background:#f3f0e6!important;color:#071d36!important;box-shadow:0 30px 90px rgba(7,29,54,.32)!important}
    body.tsl-editorial #pcBox h2{color:#071d36!important;font-family:Georgia,"Times New Roman",serif!important;font-size:34px!important}
    body.tsl-editorial #pcBox h3{color:#071d36!important;font-family:Georgia,"Times New Roman",serif!important;text-transform:none!important;letter-spacing:-.02em!important}
    body.tsl-editorial #pcBox p{color:#506071!important}
    body.tsl-editorial #pcClose{border:1px solid #071d36!important;border-radius:0!important;background:transparent!important;color:#071d36!important}
    body.tsl-editorial .pcheader{border:1px solid #071d36!important;border-radius:0!important;background:#fffdf7!important;color:#071d36!important}
    body.tsl-editorial .pcheader::before{display:none!important}
    body.tsl-editorial .pcheader.pctheme-fire{border-left:6px solid #ff5425!important}
    body.tsl-editorial .pcheader.pctheme-ice{border-left:6px solid #1268f3!important}
    body.tsl-editorial .pc-headshot{border-color:rgba(7,29,54,.25)!important;background:#e9e4d7!important;box-shadow:none!important}
    body.tsl-editorial .pc-headshot-fallback{color:#071d36!important}
    body.tsl-editorial .pcprob{border:1px solid #1268f3!important;border-radius:0!important;background:rgba(18,104,243,.06)!important}
    body.tsl-editorial .pcprob b{color:#1268f3!important}
    body.tsl-editorial .pcprob span{color:#506071!important}
    body.tsl-editorial .pcchip{border-radius:0!important;box-shadow:none!important}
    body.tsl-editorial .pcchip-base{border-color:rgba(7,29,54,.2)!important;background:#fffdf7!important;color:#071d36!important}
    body.tsl-editorial .pcchip-split{border-color:#6b3fa0!important;background:#efe5ff!important;color:#4a1f78!important}
    body.tsl-editorial .pctabs{border-color:#071d36!important;background:transparent!important}
    body.tsl-editorial .pctab{border:1px solid #071d36!important;border-radius:0!important;background:transparent!important;color:#071d36!important}
    body.tsl-editorial .pctab.on,body.tsl-editorial .pctab.active{border-color:#1268f3!important;background:#1268f3!important;color:#fff!important}
    body.tsl-editorial .pcm,body.tsl-editorial .pcbar,body.tsl-editorial .pcpitch-card,body.tsl-editorial .pcpark-main,body.tsl-editorial .pcpark-card,body.tsl-editorial .pcpark-note,body.tsl-editorial .pcdecision,body.tsl-editorial .pcreason,body.tsl-editorial .pcwhy-row,body.tsl-editorial .pcvuln-card,body.tsl-editorial .pcbp-risk-card,body.tsl-editorial .pcbp-risk-note{border:1px solid rgba(7,29,54,.18)!important;border-radius:0!important;background:#fffdf7!important;color:#071d36!important;box-shadow:none!important}
    body.tsl-editorial .pcm label,body.tsl-editorial .pcbar-top,body.tsl-editorial .pcpark-main span,body.tsl-editorial .pcpark-card span,body.tsl-editorial .pcsection-head p{color:#506071!important}
    body.tsl-editorial .pcm b,body.tsl-editorial .pcpark-main strong,body.tsl-editorial .pcsection-head h3{color:#1268f3!important}
    body.tsl-editorial .pcpark-card strong,body.tsl-editorial .pcpitch-card strong,body.tsl-editorial .pcwhy-row strong{color:#071d36!important}
    body.tsl-editorial .pcpitch-summary{align-items:stretch!important;grid-auto-rows:1fr!important}
    body.tsl-editorial .pcpitch-card{display:flex!important;min-height:78px!important;height:100%!important;flex-direction:column!important;justify-content:space-between!important}
    body.tsl-editorial .pcpitch-card span{color:#41566b!important}
    body.tsl-editorial .pcpitch-card.hot{border-color:#a23c17!important;background:#ffeadf!important}
    body.tsl-editorial .pcpitch-card.hot strong{color:#7a2d12!important}
    body.tsl-editorial .pcpitchtable,body.tsl-editorial .pcspottable{border:1px solid #071d36!important;border-radius:0!important;background:#fffdf7!important}
    body.tsl-editorial .pcpitchtable{overflow-x:auto!important}
    body.tsl-editorial .pcpitchrow,body.tsl-editorial .pcspotrow{border-color:rgba(7,29,54,.16)!important;color:#071d36!important}
    body.tsl-editorial .pcpitchrow{grid-template-columns:minmax(140px,1.5fr) repeat(4,minmax(70px,1fr))!important;min-width:680px!important}
    body.tsl-editorial .pcpitchrow>*{min-width:0!important}
    body.tsl-editorial .pcpitchrow.head{background:#071d36!important;color:#fff!important}
    body.tsl-editorial .pcpitchrow strong,body.tsl-editorial .pcspotleft b{color:#9b3219!important}
    body.tsl-editorial .pcpitchrow .good{color:#075d4c!important}
    body.tsl-editorial .pcpitchrow .hot{color:#7a2d12!important}
    body.tsl-editorial .pcspotleft span,body.tsl-editorial .pcspotright span,body.tsl-editorial .pcspotbars label{color:#41566b!important}
    body.tsl-editorial .pcai-card{border:1px solid #071d36!important;border-radius:0!important;background:#fffdf7!important;box-shadow:none!important}
    body.tsl-editorial .pcai-card::before{display:none!important}
    body.tsl-editorial .pcai-head h3,body.tsl-editorial .pcai-summary{color:#071d36!important;text-shadow:none!important}
    body.tsl-editorial .pcai-grade{border-color:#1268f3!important;background:#1268f3!important;color:#fff!important;box-shadow:none!important}
    body.tsl-editorial .pcai-reasons span{border-color:rgba(7,29,54,.18)!important;border-radius:0!important;background:#f3f0e6!important;color:#071d36!important}
    body.tsl-editorial .pczone-header-compact{border:1px solid #071d36!important;border-radius:0!important;background:#fffdf7!important;box-shadow:none!important}
    body.tsl-editorial .pczone-header-copy h3,body.tsl-editorial .pczone-score-card strong{color:#1268f3!important}
    body.tsl-editorial .pczone-header-copy p{color:#31465a!important}
    body.tsl-editorial .pczone-score-card{border:1px solid #1268f3!important;border-radius:0!important;background:rgba(18,104,243,.06)!important;box-shadow:none!important}
    body.tsl-editorial .pczone-matchup-tag{border:1px solid #1268f3!important;border-radius:0!important;background:#e8f1ff!important;color:#084aab!important}
    body.tsl-editorial .pczone-score-card span{color:#41566b!important}
    body.tsl-editorial .pczone-score-card span::after{content:""!important}
    body.tsl-editorial .pcwhy{border:1px solid rgba(7,29,54,.22)!important;border-radius:0!important;background:#f3f0e6!important;color:#071d36!important}
    body.tsl-editorial .pcwhy-hero{border:1px solid rgba(7,93,76,.28)!important;border-radius:0!important;background:#eef5e5!important}
    body.tsl-editorial .pcwhy-hero h3{color:#071d36!important}
    body.tsl-editorial .pcwhy-hero p{color:#31465a!important}
    body.tsl-editorial .pcwhy-row span{color:#071d36!important}
    body.tsl-editorial .pcwhy-row b{color:#9b3219!important}
    body.tsl-editorial .pcintel{border:1px solid rgba(7,29,54,.22)!important;border-radius:0!important;background:#fffdf7!important;color:#071d36!important}
    body.tsl-editorial .pcintel h3{color:#071d36!important}
    body.tsl-editorial .pcintel p{color:#41566b!important}
    body.tsl-editorial .pcwhy-score{border-color:#075d4c!important;border-radius:0!important;background:#071d36!important}
    body.tsl-editorial .pcwhy-score strong{color:#adff2f!important}
    body.tsl-editorial .pcwhy-score span{color:#d6e0e8!important}
    body.tsl-editorial .pczone-legend-explained{grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:6px!important}
    body.tsl-editorial .pczone-legend-explained .leg-row{min-width:0!important;border:1px solid rgba(7,29,54,.16)!important;border-radius:0!important;background:#f3f0e6!important}
    body.tsl-editorial .pczone-legend-explained small{color:#41566b!important;white-space:normal!important}
    body.tsl-editorial .pczone-grid-upgraded,body.tsl-editorial .pczone-grid-premium{width:100%!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:16px!important;align-items:stretch!important;justify-content:stretch!important}
    body.tsl-editorial .pcz-clean{width:auto!important;max-width:none!important;min-width:0!important;height:100%!important;justify-self:stretch!important;padding:17px!important;border:1px solid rgba(7,29,54,.22)!important;border-top:4px solid #1268f3!important;border-radius:0!important;background:#fffdf7!important;box-shadow:0 12px 28px rgba(7,29,54,.08)!important;backdrop-filter:none!important}
    body.tsl-editorial .pcz-clean.pcz-primary{border-color:rgba(7,29,54,.22)!important;border-top-color:#075d4c!important;box-shadow:0 12px 28px rgba(7,29,54,.08)!important}
    body.tsl-editorial .pcz-clean.pcz-pitcher{border-color:rgba(7,29,54,.22)!important;border-top-color:#9b3219!important;box-shadow:0 12px 28px rgba(7,29,54,.08)!important}
    body.tsl-editorial .pcz-clean-head{min-height:54px!important;margin-bottom:14px!important;padding:0 0 12px!important;border:0!important;border-bottom:1px solid rgba(7,29,54,.16)!important;border-radius:0!important;background:transparent!important}
    body.tsl-editorial .pcz-clean-icon{border:1px solid rgba(18,104,243,.28)!important;border-radius:0!important;background:#e8f1ff!important;color:#084aab!important}
    body.tsl-editorial .pcz-clean-copy{display:block!important;width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;color:#071d36!important}
    body.tsl-editorial .pcz-clean-copy b,body.tsl-editorial .pcz-primary .pcz-clean-copy b{display:block!important;width:auto!important;min-width:0!important;margin:0 0 5px!important;padding:0!important;border:0!important;background:transparent!important;color:#071d36!important;font-family:Georgia,"Times New Roman",serif!important;font-size:16px!important;line-height:1.1!important;text-transform:none!important}
    body.tsl-editorial .pcz-clean-copy small{display:block!important;width:auto!important;min-width:0!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;color:#41566b!important;font-size:11px!important;line-height:1.3!important}
    body.tsl-editorial .pcz-clean-board{padding:11px!important;border:1px solid rgba(7,29,54,.2)!important;border-radius:0!important;background:#e9e4d7!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.65)!important}
    body.tsl-editorial .pcz-clean-board span{border-radius:3px!important;color:#fff!important;text-shadow:0 1px 1px rgba(0,0,0,.45)!important}
    body.tsl-editorial .pcz-clean-board .z1{background:#17345a!important;color:#fff!important}
    body.tsl-editorial .pcz-clean-board .z2{background:#12605d!important;color:#fff!important}
    body.tsl-editorial .pcz-clean-board .z3{background:#657d18!important;color:#fff!important}
    body.tsl-editorial .pcz-clean-board .z4{background:#a86b05!important;color:#fff!important}
    body.tsl-editorial .pcz-clean-board .z5{background:#c9482f!important;color:#fff!important}
    body.tsl-editorial .pcz-clean-board .zdanger{background:#b5152f!important;color:#fff!important}
    body.tsl-editorial .pcz-clean-axis{width:190px!important;margin-top:9px!important;color:#41566b!important}
    body.tsl-editorial .pcz-clean-axis span{display:inline!important;width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;color:#41566b!important;font-weight:900!important;text-shadow:none!important}
    body.tsl-editorial .pcz-primary .pcz-clean-head::after{border-color:#075d4c!important;border-radius:0!important;background:#e1f5ed!important;color:#075d4c!important}
    @media(max-width:900px){body.tsl-editorial .pczone-legend-explained{grid-template-columns:repeat(2,minmax(0,1fr))!important}body.tsl-editorial .pczone-grid-premium{grid-template-columns:1fr!important}}
    body.tsl-editorial .pcsection-head span{border:1px solid #ff5425!important;border-radius:0!important;background:rgba(255,84,37,.06)!important;color:#9b3219!important}
    html[data-theme="dark"] body.tsl-editorial #pcClose{border-color:rgba(255,255,255,.35)!important;color:#fff!important}
    html[data-theme="dark"] body.tsl-editorial .pcprob{background:rgba(18,104,243,.14)!important}
    html[data-theme="dark"] body.tsl-editorial .pcm,html[data-theme="dark"] body.tsl-editorial .pcbar,html[data-theme="dark"] body.tsl-editorial .pcpitch-card,html[data-theme="dark"] body.tsl-editorial .pcpark-main,html[data-theme="dark"] body.tsl-editorial .pcpark-card,html[data-theme="dark"] body.tsl-editorial .pcpark-note,html[data-theme="dark"] body.tsl-editorial .pcdecision,html[data-theme="dark"] body.tsl-editorial .pcreason,html[data-theme="dark"] body.tsl-editorial .pcwhy-row,html[data-theme="dark"] body.tsl-editorial .pcvuln-card,html[data-theme="dark"] body.tsl-editorial .pcbp-risk-card,html[data-theme="dark"] body.tsl-editorial .pcbp-risk-note,html[data-theme="dark"] body.tsl-editorial .pcmatch-read,html[data-theme="dark"] body.tsl-editorial .pcmatch-split{background:#101719!important;color:#f4fff8!important;border-color:rgba(255,255,255,.16)!important}
    html[data-theme="dark"] body.tsl-editorial .pcm label,html[data-theme="dark"] body.tsl-editorial .pcbar-top,html[data-theme="dark"] body.tsl-editorial .pcmatch-split span,html[data-theme="dark"] body.tsl-editorial .pcmatch-split small{color:#aebcb6!important}
    html[data-theme="dark"] body.tsl-editorial .pcm b,html[data-theme="dark"] body.tsl-editorial .pcmatch-split b,html[data-theme="dark"] body.tsl-editorial .pcmatch-head strong{color:#f4fff8!important}
    html[data-theme="dark"] body.tsl-editorial .pctab{border-color:rgba(255,255,255,.25)!important;color:#f4fff8!important}
  `;
  document.head.appendChild(s);
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

/* Clean Zone Map CSS Injection */
(function(){
  const s = document.createElement("style");
  s.textContent = `
    .pczone-grid-premium{
      display:grid!important;
      grid-template-columns:repeat(2,minmax(260px,1fr))!important;
      gap:14px!important;
      align-items:start!important;
    }
    .pcz-clean{
      padding:14px!important;
      border-radius:16px!important;
      background:linear-gradient(135deg,rgba(9,17,25,.96),rgba(4,8,13,.98))!important;
      border:1px solid rgba(255,255,255,.12)!important;
    }
    .pcz-clean-head{
      display:flex!important;
      align-items:center!important;
      gap:10px!important;
      margin-bottom:10px!important;
    }
    .pcz-clean-board{
      display:grid!important;
      grid-template-columns:repeat(5,34px)!important;
      gap:5px!important;
      width:max-content!important;
      margin:0 auto!important;
      padding:8px!important;
      border-radius:12px!important;
      background:rgba(0,0,0,.24)!important;
    }
    .pcz-clean-board span{
      width:34px!important;
      height:25px!important;
      display:grid!important;
      place-items:center!important;
      border-radius:7px!important;
      font-size:10px!important;
      font-weight:1000!important;
    }
    .pcz-clean-axis{
      display:flex!important;
      justify-content:space-between!important;
      width:190px!important;
      margin:7px auto 0!important;
      font-size:8px!important;
      text-transform:uppercase!important;
    }
  `;
  document.head.appendChild(s);
})();

/* Zone Map Glass Polish */
(function(){
  const s = document.createElement("style");
  s.textContent = `
    .pcz-clean{
      background:
        radial-gradient(circle at 15% 0%, rgba(147,255,45,.10), transparent 34%),
        linear-gradient(135deg, rgba(18,28,38,.72), rgba(4,8,13,.88))!important;
      border:1px solid rgba(255,255,255,.16)!important;
      box-shadow:
        0 18px 42px rgba(0,0,0,.34),
        inset 0 1px 0 rgba(255,255,255,.08),
        inset 0 0 26px rgba(255,255,255,.03)!important;
      backdrop-filter:blur(14px)!important;
    }

    .pcz-clean.pcz-primary{
      border-color:rgba(147,255,45,.55)!important;
      box-shadow:
        0 0 28px rgba(147,255,45,.16),
        0 18px 42px rgba(0,0,0,.34),
        inset 0 1px 0 rgba(255,255,255,.10)!important;
    }

    .pcz-clean.pcz-pitcher{
      border-color:rgba(255,83,92,.42)!important;
      box-shadow:
        0 0 22px rgba(255,56,74,.10),
        0 18px 42px rgba(0,0,0,.34),
        inset 0 1px 0 rgba(255,255,255,.08)!important;
    }

    .pcz-clean-head{
      min-height:38px!important;
      padding:6px 7px!important;
      border-radius:12px!important;
      background:rgba(255,255,255,.035)!important;
      border:1px solid rgba(255,255,255,.06)!important;
    }

    .pcz-clean-copy b{
      font-size:11px!important;
      color:#ffb000!important;
    }

    .pcz-primary .pcz-clean-copy b{
      color:#93ff2d!important;
    }

    .pcz-clean-copy small{
      font-size:10px!important;
      color:rgba(255,255,255,.72)!important;
    }

    .pcz-clean-board{
      box-shadow:
        inset 0 0 18px rgba(0,0,0,.38),
        0 0 18px rgba(255,255,255,.035)!important;
    }

    .pcz-clean-axis span{
      padding:4px 6px!important;
      border-radius:7px!important;
      background:rgba(255,255,255,.045)!important;
    }
  `;
  document.head.appendChild(s);
})();

/* Zone Map Header Cleanup */
(function(){
  const s = document.createElement("style");
  s.textContent = `
    .pcz-clean-head{
      display:grid!important;
      grid-template-columns:42px 1fr!important;
      gap:10px!important;
      align-items:center!important;
      padding:8px 10px!important;
      min-height:46px!important;
    }

    .pcz-clean-icon{
      width:34px!important;
      height:34px!important;
      border-radius:11px!important;
      font-size:15px!important;
    }

    .pcz-clean-copy{
      display:grid!important;
      grid-template-columns:auto 1fr!important;
      align-items:center!important;
      gap:8px!important;
      width:100%!important;
    }

    .pcz-clean-copy b{
      white-space:nowrap!important;
      font-size:13px!important;
      line-height:1!important;
      margin:0!important;
    }

    .pcz-clean-copy small{
      display:block!important;
      white-space:normal!important;
      font-size:12px!important;
      line-height:1.15!important;
      margin:0!important;
      color:rgba(255,255,255,.78)!important;
      max-width:none!important;
    }

    .pcz-clean{
      min-width:250px!important;
    }

    .pcz-clean-board{
      margin-top:12px!important;
    }
  `;
  document.head.appendChild(s);
})();


/* Compact Zone Power Map Header */
(function(){
  const s = document.createElement("style");
  s.textContent = `
    .pczone-header-compact{
      display:grid!important;
      grid-template-columns:1fr 135px!important;
      gap:14px!important;
      align-items:center!important;
      margin-bottom:14px!important;
      padding:13px 15px!important;
      border:1px solid rgba(140,255,50,.16)!important;
      border-radius:16px!important;
      background:
        radial-gradient(circle at 8% 0%, rgba(140,255,50,.09), transparent 34%),
        rgba(8,14,18,.78)!important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.06)!important;
    }

    .pczone-header-copy h3{
      margin:0 0 7px!important;
      color:#8cff32!important;
      font-size:15px!important;
      letter-spacing:1.6px!important;
      text-transform:uppercase!important;
    }

    .pczone-matchup-tag{
      display:inline-block!important;
      padding:5px 10px!important;
      border-radius:999px!important;
      background:rgba(255,176,0,.12)!important;
      border:1px solid rgba(255,176,0,.25)!important;
      color:#ffb000!important;
      font-size:12px!important;
      font-weight:900!important;
      margin-bottom:7px!important;
    }

    .pczone-header-copy p{
      margin:0 0 10px!important;
      color:#d8dee6!important;
      font-size:12px!important;
      line-height:1.35!important;
    }

    .pczone-legend-pills{
      display:flex!important;
      gap:7px!important;
      flex-wrap:wrap!important;
    }

    .pczone-legend-pills span{
      padding:4px 8px!important;
      border-radius:999px!important;
      font-size:10px!important;
      font-weight:900!important;
      color:white!important;
      text-transform:uppercase!important;
      letter-spacing:.3px!important;
    }

    .pczone-legend-pills .cold{background:#1d3f6e!important}
    .pczone-legend-pills .neutral{background:#5b5b5b!important}
    .pczone-legend-pills .warm{background:#b98216!important}
    .pczone-legend-pills .hot{background:#d24b2d!important}
    .pczone-legend-pills .nuclear{background:#c42020!important}

    .pczone-score-card{
      text-align:center!important;
      padding:11px 10px!important;
      border-radius:14px!important;
      background:rgba(140,255,50,.07)!important;
      border:1px solid rgba(140,255,50,.24)!important;
      box-shadow:0 0 18px rgba(140,255,50,.08)!important;
    }

    .pczone-score-card strong{
      display:block!important;
      font-size:34px!important;
      color:#8cff32!important;
      line-height:1!important;
      margin-bottom:4px!important;
    }

    .pczone-score-card span{
      color:#ffb000!important;
      font-size:11px!important;
      font-weight:1000!important;
      letter-spacing:.7px!important;
    }
  `;
  document.head.appendChild(s);
})();

/* Final Zone Map Polish */
(function(){
  const s = document.createElement("style");
  s.textContent = `
    .pczone-header-compact{
      padding:11px 14px!important;
      margin-bottom:12px!important;
      grid-template-columns:1fr 118px!important;
    }

    .pczone-score-card{
      padding:9px 10px!important;
    }

    .pczone-score-card strong{
      font-size:30px!important;
    }

    .pczone-score-card span::after{
      content:" MATCH";
    }

    .pcz-clean-head{
      grid-template-columns:34px 1fr!important;
      min-height:50px!important;
    }

    .pcz-clean-copy{
      display:block!important;
    }

    .pcz-clean-copy b{
      display:block!important;
      font-size:12px!important;
      margin-bottom:4px!important;
    }

    .pcz-clean-copy small{
      display:block!important;
      font-size:10px!important;
      line-height:1.2!important;
    }

    .pcz-primary{
      box-shadow:
        0 0 32px rgba(140,255,50,.22),
        inset 0 1px 0 rgba(255,255,255,.10)!important;
    }

    .pcz-primary .pcz-clean-head::after{
      content:"PRIMARY";
      margin-left:auto;
      padding:3px 7px;
      border-radius:999px;
      background:rgba(140,255,50,.13);
      border:1px solid rgba(140,255,50,.28);
      color:#8cff32;
      font-size:9px;
      font-weight:1000;
      letter-spacing:.5px;
    }

    .pczone-grid-premium{
      gap:12px!important;
    }
  `;
  document.head.appendChild(s);
})();


/* Explained Zone Legend */
(function(){
  const s = document.createElement("style");
  s.textContent = `
    .pczone-legend-explained{
      display:grid!important;
      grid-template-columns:repeat(5,max-content)!important;
      gap:8px!important;
      align-items:center!important;
      margin-top:8px!important;
    }

    .pczone-legend-explained .leg-row{
      display:flex!important;
      align-items:center!important;
      gap:6px!important;
      padding:5px 7px!important;
      border-radius:999px!important;
      background:rgba(255,255,255,.045)!important;
      border:1px solid rgba(255,255,255,.08)!important;
    }

    .pczone-legend-explained .leg-chip{
      padding:3px 7px!important;
      border-radius:999px!important;
      color:white!important;
      font-size:9px!important;
      font-weight:1000!important;
      text-transform:uppercase!important;
    }

    .pczone-legend-explained small{
      color:rgba(255,255,255,.72)!important;
      font-size:10px!important;
      font-weight:800!important;
      white-space:nowrap!important;
    }

    .pczone-legend-explained .cold .leg-chip{background:#1d3f6e!important}
    .pczone-legend-explained .neutral .leg-chip{background:#5b5b5b!important}
    .pczone-legend-explained .warm .leg-chip{background:#b98216!important}
    .pczone-legend-explained .hot .leg-chip{background:#d24b2d!important}
    .pczone-legend-explained .nuclear .leg-chip{background:#c42020!important}

    @media(max-width:900px){
      .pczone-legend-explained{
        grid-template-columns:repeat(2,max-content)!important;
      }
    }
  `;
  document.head.appendChild(s);
})();



/* Slip Lab AI Breakdown Card */
(function(){
  const s = document.createElement("style");
  s.textContent = `
    .pcai-card{
      position:relative!important;
      overflow:hidden!important;
      margin:14px 0!important;
      padding:15px!important;
      border-radius:20px!important;
      border:1px solid rgba(140,255,50,.25)!important;
      background:
        radial-gradient(circle at 18% 0%, rgba(140,255,50,.16), transparent 34%),
        radial-gradient(circle at 88% 18%, rgba(255,176,0,.13), transparent 32%),
        linear-gradient(180deg, rgba(255,255,255,.065), rgba(255,255,255,.025))!important;
      box-shadow:
        0 0 28px rgba(140,255,50,.13),
        inset 0 1px 0 rgba(255,255,255,.10)!important;
    }

    .pcai-card:before{
      content:"";
      position:absolute;
      inset:-2px;
      background:linear-gradient(110deg, transparent 0%, rgba(140,255,50,.18) 42%, rgba(255,176,0,.16) 50%, transparent 62%);
      transform:translateX(-70%);
      animation:pcaiSweep 5.5s ease-in-out infinite;
      pointer-events:none;
    }

    @keyframes pcaiSweep{
      0%,68%{transform:translateX(-75%);opacity:.0}
      76%{opacity:.75}
      100%{transform:translateX(75%);opacity:0}
    }

    .pcai-head{
      position:relative!important;
      z-index:2!important;
      margin-bottom:10px!important;
    }

    .pcai-head h3{
      color:#fff!important;
      text-shadow:0 0 18px rgba(140,255,50,.22)!important;
    }

    .pcai-grade{
      background:rgba(140,255,50,.12)!important;
      border:1px solid rgba(140,255,50,.34)!important;
      color:#8cff32!important;
      box-shadow:0 0 18px rgba(140,255,50,.13)!important;
    }

    .pcai-summary{
      position:relative!important;
      z-index:2!important;
      margin:0!important;
      color:#eef3f8!important;
      font-size:13px!important;
      line-height:1.55!important;
      font-weight:750!important;
    }

    .pcai-reasons{
      position:relative!important;
      z-index:2!important;
      display:flex!important;
      flex-wrap:wrap!important;
      gap:7px!important;
      margin-top:12px!important;
    }

    .pcai-reasons span{
      display:inline-flex!important;
      align-items:center!important;
      gap:5px!important;
      padding:6px 9px!important;
      border-radius:999px!important;
      background:rgba(0,0,0,.22)!important;
      border:1px solid rgba(255,255,255,.10)!important;
      color:#dfe7ef!important;
      font-size:10px!important;
      font-weight:950!important;
      letter-spacing:.2px!important;
    }

    @media(max-width:720px){
      .pcai-card{padding:13px!important}
      .pcai-summary{font-size:12px!important}
      .pcai-grade{margin-top:8px!important}
    }
  `;
  document.head.appendChild(s);
})();

/* Keep the scoped editorial shell last in the cascade after legacy card polish. */
(function(){
  const editorial = document.getElementById("pcEditorialCss");
  if (editorial) document.head.appendChild(editorial);
})();

/* Final player-detail accessibility layer. Keep this last: legacy modules inject mixed themes. */
(function(){
  if (!document.body.classList.contains("tsl-editorial") || document.getElementById("pcReadableCss")) return;
  const readable = document.createElement("style");
  readable.id = "pcReadableCss";
  readable.textContent = `
    body.tsl-editorial #pcFull{padding:14px!important;background:rgba(3,15,31,.82)!important;backdrop-filter:blur(8px)!important}
    body.tsl-editorial #pcBox{max-width:920px!important;padding:12px!important;border:1px solid rgba(18,104,243,.28)!important;border-radius:22px!important;background:linear-gradient(145deg,#f9fbff,#edf4ff)!important;color:#071d36!important;box-shadow:0 34px 100px rgba(2,11,24,.48),0 0 40px rgba(18,104,243,.18)!important}
    body.tsl-editorial #pcBox,body.tsl-editorial #pcBox p,body.tsl-editorial #pcBox li,body.tsl-editorial #pcBox td,body.tsl-editorial #pcBox th,body.tsl-editorial #pcBox div{color:#071d36}
    body.tsl-editorial #pcBox h2{font-family:Inter,Arial,sans-serif!important;font-size:26px!important;line-height:1!important;color:#071d36!important}
    body.tsl-editorial #pcBox h3{font-family:Inter,Arial,sans-serif!important;font-size:17px!important;line-height:1.1!important;color:#071d36!important}
    body.tsl-editorial #pcBox p{font-size:12px!important;line-height:1.45!important;color:#41566b!important}
    body.tsl-editorial #pcClose{border:1px solid rgba(18,104,243,.35)!important;border-radius:11px!important;background:#071d36!important;color:#fff!important;box-shadow:0 7px 18px rgba(7,29,54,.18)!important}
    body.tsl-editorial .pcheader{padding:12px!important;border:1px solid rgba(18,104,243,.2)!important;border-radius:17px!important;background:radial-gradient(circle at 100% 0,rgba(56,217,255,.15),transparent 34%),linear-gradient(145deg,#fff,#eaf3ff)!important;box-shadow:0 10px 26px rgba(7,29,54,.1)!important}
    body.tsl-editorial .pc-headshot{width:52px!important;height:52px!important;flex-basis:52px!important;border:3px solid #fff!important;box-shadow:0 6px 16px rgba(7,29,54,.2),0 0 0 2px rgba(18,104,243,.2)!important}
    body.tsl-editorial .pcprob{width:94px!important;height:72px!important;border-radius:14px!important;background:linear-gradient(145deg,#1268f3,#0b4cae)!important;box-shadow:0 9px 22px rgba(18,104,243,.24)!important}
    body.tsl-editorial .pcprob b,body.tsl-editorial .pcprob span{color:#fff!important}
    body.tsl-editorial .pcchips{gap:5px!important;margin-top:7px!important}.pcchip{padding:4px 7px!important;border-radius:999px!important;font-size:8px!important;box-shadow:none!important}
    body.tsl-editorial .pctabs{gap:5px!important;margin:9px 0!important;padding:5px!important;border:1px solid rgba(18,104,243,.14)!important;border-radius:13px!important;background:#e4eefc!important}
    body.tsl-editorial .pctab{min-height:34px!important;padding:8px 11px!important;border:0!important;border-radius:9px!important;background:transparent!important;color:#203b58!important;font-size:10px!important;box-shadow:none!important}
    body.tsl-editorial .pctab.on,body.tsl-editorial .pctab.active{background:linear-gradient(135deg,#1268f3,#3184ff)!important;color:#fff!important;box-shadow:0 7px 18px rgba(18,104,243,.24)!important}
    body.tsl-editorial .pcbiggrid,body.tsl-editorial .pcgrid{gap:6px!important}.pcm{min-height:44px!important;padding:7px!important}
    body.tsl-editorial .pcm,body.tsl-editorial .pcbar,body.tsl-editorial .pcpitch-card,body.tsl-editorial .pcdecision,body.tsl-editorial .pcreason,body.tsl-editorial .pcwhy-row,body.tsl-editorial .pcmatch-split,body.tsl-editorial .pcvuln-card,body.tsl-editorial .pcvuln-zone,body.tsl-editorial .pcbp-risk-main,body.tsl-editorial .pcbp-risk-card,body.tsl-editorial .pcpark-main,body.tsl-editorial .pcpark-card{border:1px solid rgba(18,104,243,.16)!important;border-radius:12px!important;background:linear-gradient(145deg,#fff,#edf4ff)!important;color:#071d36!important;box-shadow:0 6px 16px rgba(7,29,54,.07),inset 0 1px #fff!important}
    body.tsl-editorial .pcm label,body.tsl-editorial .pcbar-top,body.tsl-editorial .pcpitch-card span,body.tsl-editorial .pcdecision span,body.tsl-editorial .pcmatch-split span,body.tsl-editorial .pcmatch-split small,body.tsl-editorial .pcvuln-card span,body.tsl-editorial .pcbp-risk-main span,body.tsl-editorial .pcbp-risk-card span,body.tsl-editorial .pcpark-main span,body.tsl-editorial .pcpark-card span{color:#526981!important}
    body.tsl-editorial .pcm b,body.tsl-editorial .pcpitch-card strong,body.tsl-editorial .pcdecision strong,body.tsl-editorial .pcmatch-split b,body.tsl-editorial .pcvuln-card strong,body.tsl-editorial .pcvuln-zone b,body.tsl-editorial .pcbp-risk-card strong,body.tsl-editorial .pcpark-card strong{color:#071d36!important}
    body.tsl-editorial .pcmatch-read,body.tsl-editorial .pcverdict,body.tsl-editorial .pcvuln,body.tsl-editorial .pcbp-snapshot,body.tsl-editorial .pcpark-profile,body.tsl-editorial .pcintel,body.tsl-editorial .pcwhy,body.tsl-editorial .pcai-card{padding:11px!important;border:1px solid rgba(18,104,243,.17)!important;border-radius:16px!important;background:linear-gradient(145deg,#f7faff,#e9f2ff)!important;color:#071d36!important;box-shadow:0 9px 24px rgba(7,29,54,.08)!important}
    body.tsl-editorial .pcverdict.green{background:linear-gradient(145deg,#f5ffe9,#e5f6d0)!important;border-color:rgba(76,167,25,.32)!important}body.tsl-editorial .pcverdict.strong{background:linear-gradient(145deg,#fff9e8,#ffefd0)!important}body.tsl-editorial .pcverdict.live,body.tsl-editorial .pcbp-snapshot{background:linear-gradient(145deg,#eefcff,#e1f4fb)!important}
    body.tsl-editorial .pcverdict-top h3,body.tsl-editorial .pcwhy-hero h3,body.tsl-editorial .pcmatch-head strong,body.tsl-editorial .pcsection-head h3,body.tsl-editorial .pcai-head h3{color:#071d36!important;text-shadow:none!important}
    body.tsl-editorial .pcverdict-top p,body.tsl-editorial .pcwhy-hero p,body.tsl-editorial .pcvuln-note,body.tsl-editorial .pcbp-risk-note,body.tsl-editorial .pcpark-note,body.tsl-editorial .pcrecent-note,body.tsl-editorial .pcai-summary{color:#31465a!important}
    body.tsl-editorial .pcverdict-score,body.tsl-editorial .pcwhy-score{border:1px solid rgba(18,104,243,.3)!important;border-radius:13px!important;background:#071d36!important}body.tsl-editorial .pcverdict-score strong,body.tsl-editorial .pcwhy-score strong{color:#9bea3a!important}body.tsl-editorial .pcverdict-score small,body.tsl-editorial .pcwhy-score span{color:#dce9f7!important}
    body.tsl-editorial .pcverdict-check{border:1px solid rgba(7,29,54,.15)!important;background:rgba(255,255,255,.72)!important;color:#41566b!important}body.tsl-editorial .pcverdict-check.on{background:#e5f6d0!important;color:#071d36!important}
    body.tsl-editorial .pcl7hero{gap:7px!important}.pcl7hero div{padding:9px!important;border-radius:12px!important;background:#fff2df!important}.pcl7hero b{font-size:19px!important;color:#a84b00!important}.pcl7hero span{color:#526981!important}
    body.tsl-editorial .pctable{border:1px solid rgba(18,104,243,.18)!important;border-radius:13px!important;background:#cbd9ea!important}.pctable div{padding:7px!important;background:#fff!important;color:#071d36!important}.pctable div:nth-child(-n+5){background:#071d36!important;color:#fff!important}
    body.tsl-editorial .pcpitchtable,body.tsl-editorial .pcspottable{border:1px solid rgba(18,104,243,.2)!important;border-radius:13px!important;background:#fff!important}.pcpitchrow,.pcspotrow{color:#071d36!important}.pcpitchrow.head{background:#071d36!important;color:#fff!important}
    body.tsl-editorial .pcvuln-note,body.tsl-editorial .pcbp-risk-note,body.tsl-editorial .pcpark-note,body.tsl-editorial .pcrecent-note{border:1px solid rgba(18,104,243,.12)!important;border-radius:11px!important;background:rgba(255,255,255,.72)!important}
    body.tsl-editorial .pcvuln-zone span{color:#08705b!important}.pcvuln-card.main strong{color:#d85a16!important}.pcbp-risk-main strong{color:#05748a!important}.pcpark-main strong{color:#08705b!important}
    body.tsl-slate-page .bat{min-height:72px!important;padding:9px 10px!important;grid-template-columns:48px minmax(0,1fr) 74px!important}body.tsl-slate-page .bat-name{font-size:13px!important}body.tsl-slate-page .sweet-note,body.tsl-slate-page .sweet-why,body.tsl-slate-page .sweet-l7{font-size:10px!important;line-height:1.35!important}body.tsl-slate-page .player-stat-grid{gap:5px!important}.player-stat{min-height:42px!important;padding:6px!important}.player-stat label{font-size:8px!important}.player-stat b{font-size:12px!important}
    @media(max-width:850px){body.tsl-editorial #pcFull{padding:7px!important}body.tsl-editorial #pcBox{padding:9px!important;border-radius:16px!important}body.tsl-editorial #pcBox h2{font-size:22px!important}.pcbiggrid,.pcgrid,.pcbars,.pcprofile,.pcmatch-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.pctab{padding:7px 9px!important}.pcverdict-checks{grid-template-columns:repeat(2,minmax(0,1fr))!important}body.tsl-slate-page .bat{grid-template-columns:44px minmax(0,1fr) 64px!important}}
  `;
  document.head.appendChild(readable);
})();
