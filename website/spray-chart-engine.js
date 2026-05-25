(function () {
  let profiles = [];
  let sprayData = {};
  let lastPlayer = "";

  function clean(v) {
    return String(v || "").trim();
  }

  function key(v) {
    return clean(v).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  async function getJSON(file, fallback) {
    try {
      const res = await fetch(file + "?v=" + Date.now());
      return await res.json();
    } catch {
      return fallback;
    }
  }

  async function loadAll() {
    const profileFile = await getJSON("./data/player_card_profiles.json", { players: [] });
    const sprayFile = await getJSON("./data/player_spray_charts.json", {});

    profiles = Array.isArray(profileFile.players) ? profileFile.players : [];
    sprayData = sprayFile || {};
  }

  function profileByName(name) {
    const target = key(name);
    return profiles.find(p => key(p.player) === target) || null;
  }

  function sprayByName(name) {
    const target = key(name);

    if (sprayData[name]) return sprayData[name];

    for (const [k, v] of Object.entries(sprayData || {})) {
      if (key(k) === target) return v;
    }

    const profile = profileByName(name);
    if (profile?.sprayChart) return profile.sprayChart;

    return null;
  }

  function capturePlayer(event) {
    const card = event.target.closest("button, article, .threat, .batter-card, .danger-batter, [data-player], [data-name]");
    if (!card) return;

    const dataName = card.dataset?.player || card.dataset?.name || card.dataset?.playerName;
    if (dataName) {
      lastPlayer = dataName;
      return;
    }

    const lines = clean(card.innerText)
      .split("\n")
      .map(x => clean(x))
      .filter(Boolean);

    const likely = lines.find(line =>
      !line.includes("Why it matters") &&
      !line.includes("score") &&
      !line.includes("AVG") &&
      !line.includes("SLG") &&
      !line.includes("OPS") &&
      line.length >= 4 &&
      profileByName(line)
    );

    if (likely) lastPlayer = likely;
  }

  function currentPlayer() {
    const modal = document.querySelector(".profile-modal.show, .modal.show, [aria-hidden='false']");
    if (!modal) return lastPlayer;

    const headings = modal.querySelectorAll("h1, h2, .player, .profile-player, [data-player-name]");
    for (const h of headings) {
      const name = h.dataset?.playerName || h.textContent;
      if (profileByName(name)) return clean(name);
    }

    return lastPlayer;
  }

  function normalizePoint(point, i) {
    const xRaw = Number(point.x ?? point.hc_x ?? point.hitX ?? point.coordX);
    const yRaw = Number(point.y ?? point.hc_y ?? point.hitY ?? point.coordY);

    if (Number.isFinite(xRaw) && Number.isFinite(yRaw)) {
      const plateX = 125;
      const plateY = 205;
      const dx = xRaw - plateX;
      const dy = plateY - yRaw;
      const angle = Math.atan2(dx, dy);
      const distance = Math.min(275, Math.sqrt(dx * dx + dy * dy) * 1.7);

      return {
        x: 500 + Math.sin(angle) * distance * 1.55,
        y: 900 - Math.cos(angle) * distance * 1.55,
        cls: pointClass(point)
      };
    }

    const angle = (-42 + (i * 17) % 84) * Math.PI / 180;
    const distance = 180 + (i * 31) % 430;

    return {
      x: 500 + Math.sin(angle) * distance,
      y: 900 - Math.cos(angle) * distance,
      cls: pointClass(point)
    };
  }

  function pointClass(point) {
    const text = clean(point.event || point.type || point.result || point.description).toLowerCase();

    if (text.includes("home") || text === "hr") return "hr";
    if (text.includes("double") || text.includes("triple") || text === "2b" || text === "3b") return "xbh";
    if (text.includes("single") || text === "1b") return "hit";
    if (text.includes("out")) return "out";

    return "bip";
  }

  function fallbackPoints(profile) {
    const hr = Number(profile?.hitterStats?.hr || 0);
    const hits = Number(profile?.hitterStats?.hits || 24);
    const total = Math.max(25, Math.min(80, hits));

    return Array.from({ length: total }, (_, i) => ({
      type: i < hr ? "home_run" : i % 5 === 0 ? "double" : i % 3 === 0 ? "single" : "out"
    }));
  }

  function fieldSvg(points) {
    const plotted = points.map(normalizePoint).map(p => ({
      ...p,
      x: Math.max(60, Math.min(940, p.x)),
      y: Math.max(70, Math.min(900, p.y))
    }));

    return `
      <div class="slip-spray-card" data-spray-chart="true">
        <svg class="slip-spray-svg" viewBox="0 0 1000 940">
          <defs>
            <radialGradient id="slipFieldGlow" cx="50%" cy="94%" r="82%">
              <stop offset="0%" stop-color="rgba(124,255,30,.22)" />
              <stop offset="62%" stop-color="rgba(124,255,30,.08)" />
              <stop offset="100%" stop-color="rgba(124,255,30,0)" />
            </radialGradient>
          </defs>

          <rect width="1000" height="940" rx="26" fill="#06110d"></rect>

          <path d="M500 900 L145 305 Q500 95 855 305 Z"
            fill="url(#slipFieldGlow)"
            stroke="rgba(124,255,30,.75)"
            stroke-width="3"></path>

          <line x1="500" y1="900" x2="500" y2="95" stroke="rgba(255,255,255,.22)" stroke-width="2"></line>
          <line x1="500" y1="900" x2="255" y2="335" stroke="rgba(255,255,255,.18)" stroke-width="3"></line>
          <line x1="500" y1="900" x2="745" y2="335" stroke="rgba(255,255,255,.18)" stroke-width="3"></line>

          <path d="M500 900 L455 855 L500 810 L545 855 Z" fill="#f5fff8"></path>

          <path d="M325 625 Q500 520 675 625" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2"></path>
          <path d="M250 445 Q500 310 750 445" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2"></path>
          <path d="M180 305 Q500 145 820 305" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2"></path>

          ${plotted.map(p => `
            <circle class="slip-dot ${p.cls}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.cls === "hr" ? 13 : p.cls === "xbh" ? 10 : 8}"></circle>
          `).join("")}
        </svg>

        <div class="slip-spray-legend">
          <span><b class="hr"></b>HR</span>
          <span><b class="xbh"></b>XBH</span>
          <span><b class="hit"></b>Hit</span>
          <span><b class="out"></b>Out</span>
          <span><b class="bip"></b>BIP</span>
        </div>
      </div>
    `;
  }

  function replaceSpray() {
    const name = currentPlayer();
    const profile = profileByName(name);
    const spray = sprayByName(name);

    let points = Array.isArray(spray?.points) ? spray.points : [];

    if (!points.length && profile) {
      points = fallbackPoints(profile);
    }

    const modal = document.querySelector(".profile-modal.show, .modal.show, [aria-hidden='false']");
    if (!modal || !points.length) return;

    const activePanel =
      Array.from(modal.querySelectorAll(".profile-tab-panel, .tab-panel, section, div"))
        .find(el => {
          const visible = getComputedStyle(el).display !== "none";
          const text = clean(el.textContent).toLowerCase();
          return visible && text.includes("spray");
        });

    const old =
      modal.querySelector("[data-spray-chart], .spray-field, .spray-wrap, .spray-profile, .slip-spray-card") ||
      activePanel;

    if (!old) return;

    old.outerHTML = fieldSvg(points);
  }

  function styles() {
    if (document.getElementById("spray-chart-engine-style")) return;

    const style = document.createElement("style");
    style.id = "spray-chart-engine-style";
    style.textContent = `
      .slip-spray-card{width:100%;border:1px solid rgba(124,255,30,.25);border-radius:18px;background:#06110d;overflow:hidden}
      .slip-spray-svg{display:block;width:100%;height:min(62vh,620px)}
      .slip-dot{stroke:rgba(255,255,255,.78);stroke-width:2;opacity:.96}
      .slip-dot.hr{fill:#ff4f6d}
      .slip-dot.xbh{fill:#ffd34a}
      .slip-dot.hit{fill:#00d6a3}
      .slip-dot.out{fill:#63aaf2}
      .slip-dot.bip{fill:#d8f7ff}
      .slip-spray-legend{display:flex;gap:12px;flex-wrap:wrap;padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);color:#dfffea;font-size:11px;font-weight:900;background:#081510}
      .slip-spray-legend span{display:inline-flex;align-items:center;gap:5px}
      .slip-spray-legend b{width:9px;height:9px;border-radius:999px;display:inline-block}
      .slip-spray-legend .hr{background:#ff4f6d}
      .slip-spray-legend .xbh{background:#ffd34a}
      .slip-spray-legend .hit{background:#00d6a3}
      .slip-spray-legend .out{background:#63aaf2}
      .slip-spray-legend .bip{background:#d8f7ff}
    `;

    document.head.appendChild(style);
  }

  function install() {
    styles();

    document.addEventListener("click", event => {
      capturePlayer(event);

      if (clean(event.target.textContent).toLowerCase().includes("spray")) {
        setTimeout(replaceSpray, 80);
        setTimeout(replaceSpray, 250);
      }
    }, true);

    const observer = new MutationObserver(() => {
      const activeSpray = Array.from(document.querySelectorAll("button, .profile-tab-btn, .tab"))
        .some(btn => btn.classList.contains("active") && clean(btn.textContent).toLowerCase().includes("spray"));

      if (activeSpray) setTimeout(replaceSpray, 80);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    });
  }

  loadAll().then(install);
})();
