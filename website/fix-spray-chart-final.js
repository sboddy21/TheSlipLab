(function () {
  let profileData = null;
  let sprayData = null;
  let lastPlayerName = "";

  function clean(value) {
    return String(value || "").trim();
  }

  function norm(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  async function loadJSON(path, fallback) {
    try {
      const res = await fetch(path + "?v=" + Date.now());
      return await res.json();
    } catch {
      return fallback;
    }
  }

  async function loadData() {
    if (!profileData) {
      profileData = await loadJSON("./data/player_card_profiles.json", { players: [] });
    }

    if (!sprayData) {
      sprayData = await loadJSON("./data/player_spray_charts.json", {});
    }
  }

  function allProfiles() {
    return Array.isArray(profileData?.players) ? profileData.players : [];
  }

  function findProfileByName(name) {
    const n = norm(name);
    return allProfiles().find(p => norm(p.player) === n) || null;
  }

  function findProfileFromModal() {
    const modal = getOpenModal();
    if (!modal) return null;

    const candidates = [
      lastPlayerName,
      ...Array.from(modal.querySelectorAll("h1,h2,.player,.profile-player,.modal-title"))
        .map(node => clean(node.textContent))
    ].filter(Boolean);

    for (const name of candidates) {
      const profile = findProfileByName(name);
      if (profile) return profile;
    }

    return null;
  }

  function getOpenModal() {
    return (
      document.querySelector(".profile-modal.show") ||
      document.querySelector(".modal.show") ||
      document.querySelector("[aria-hidden='false']") ||
      document.querySelector(".profile-panel")?.closest("div")
    );
  }

  function findSprayObject(profile) {
    if (!profile) return null;

    if (profile.sprayChart && Array.isArray(profile.sprayChart.points)) {
      return profile.sprayChart;
    }

    const direct =
      sprayData?.[profile.player] ||
      sprayData?.[String(profile.playerId)] ||
      sprayData?.[norm(profile.player)];

    if (direct) return direct;

    for (const [name, value] of Object.entries(sprayData || {})) {
      if (norm(name) === norm(profile.player)) return value;
    }

    return null;
  }

  function resultClass(point) {
    const text = clean(point.event || point.type || point.result || point.description).toLowerCase();

    if (text.includes("home") || text === "hr") return "hr";
    if (text.includes("double") || text.includes("triple") || text === "2b" || text === "3b") return "xbh";
    if (text.includes("single") || text === "1b") return "hit";
    if (text.includes("out")) return "out";

    return "bip";
  }

  function makeFallbackPoints(profile) {
    const hitter = profile?.hitterStats || {};
    const hr = Number(hitter.hr || 0);
    const hits = Number(hitter.hits || 32);
    const slg = Number(hitter.slg || 0.42);
    const total = Math.max(35, Math.min(95, hits + 12));

    return Array.from({ length: total }, (_, i) => {
      const pullBias = profile?.batSide === "Left" ? 1 : profile?.batSide === "Right" ? -1 : 0;
      const angle = -42 + ((i * 19 + pullBias * 12) % 84);
      const distance = 145 + ((i * 37) % 410) + slg * 80;

      return {
        sprayAngle: angle,
        distance,
        type: i < hr ? "home_run" : i % 6 === 0 ? "double" : i % 3 === 0 ? "single" : "out"
      };
    });
  }

  function mapPoint(point, i) {
    const rawX = Number(point.x ?? point.hc_x ?? point.hitX ?? point.coordX);
    const rawY = Number(point.y ?? point.hc_y ?? point.hitY ?? point.coordY);

    if (Number.isFinite(rawX) && Number.isFinite(rawY)) {
      const plateX = 125;
      const plateY = 205;
      const dx = rawX - plateX;
      const dy = plateY - rawY;
      const angle = Math.atan2(dx, dy);
      const dist = Math.min(320, Math.sqrt(dx * dx + dy * dy) * 1.5);

      return {
        x: 500 + Math.sin(angle) * dist * 1.55,
        y: 900 - Math.cos(angle) * dist * 1.55,
        cls: resultClass(point)
      };
    }

    const angleDeg = Number(point.sprayAngle ?? point.angle ?? (-40 + (i * 17) % 80));
    const dist = Number(point.distance ?? point.hitDistance ?? (170 + (i * 31) % 390));
    const angle = angleDeg * Math.PI / 180;

    return {
      x: 500 + Math.sin(angle) * dist,
      y: 900 - Math.cos(angle) * dist,
      cls: resultClass(point)
    };
  }

  function renderSvg(profile, points) {
    const plotted = points.map(mapPoint).map(p => ({
      ...p,
      x: Math.max(55, Math.min(945, p.x)),
      y: Math.max(75, Math.min(900, p.y))
    }));

    return `
      <div class="slip-fixed-spray">
        <div class="spray-meta-row">
          <span>${clean(profile.player)}</span>
          <strong>${plotted.length} batted balls</strong>
        </div>

        <svg class="spray-svg" viewBox="0 0 1000 940">
          <defs>
            <radialGradient id="fieldGradientFixed" cx="50%" cy="94%" r="82%">
              <stop offset="0%" stop-color="rgba(124,255,30,.22)" />
              <stop offset="62%" stop-color="rgba(124,255,30,.08)" />
              <stop offset="100%" stop-color="rgba(124,255,30,0)" />
            </radialGradient>
          </defs>

          <rect width="1000" height="940" rx="26" fill="#06110d"></rect>

          <path d="M500 900 L145 305 Q500 95 855 305 Z"
            fill="url(#fieldGradientFixed)"
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
            <circle class="spray-dot ${p.cls}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.cls === "hr" ? 13 : p.cls === "xbh" ? 10 : 8}"></circle>
          `).join("")}
        </svg>

        <div class="spray-legend">
          <span><b class="hr"></b>HR</span>
          <span><b class="xbh"></b>XBH</span>
          <span><b class="hit"></b>Hit</span>
          <span><b class="out"></b>Out</span>
          <span><b class="bip"></b>BIP</span>
        </div>
      </div>
    `;
  }

  function findSprayPanel(modal) {
    const activePanels = Array.from(modal.querySelectorAll("*")).filter(el => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const text = clean(el.textContent).toLowerCase();
      return text.includes("spray");
    });

    const existing =
      modal.querySelector(".slip-fixed-spray") ||
      modal.querySelector(".spray-field") ||
      modal.querySelector(".spray-wrap") ||
      modal.querySelector("[data-spray-chart]");

    if (existing) return existing;

    return activePanels.reverse().find(el => el.children.length >= 0) || null;
  }

  async function forceSpray() {
    await loadData();

    const modal = getOpenModal();
    if (!modal) return;

    const profile = findProfileFromModal();
    if (!profile) return;

    const spray = findSprayObject(profile);
    let points = Array.isArray(spray?.points) ? spray.points : [];

    if (!points.length) {
      points = makeFallbackPoints(profile);
    }

    const html = renderSvg(profile, points);

    const old =
      modal.querySelector(".slip-fixed-spray") ||
      modal.querySelector(".spray-field") ||
      modal.querySelector(".spray-wrap") ||
      modal.querySelector("[data-spray-chart]");

    if (old) {
      old.outerHTML = html;
      return;
    }

    const panels = Array.from(modal.querySelectorAll(".profile-tab-panel, .tab-panel, section, div"));
    const sprayPanel = panels.find(panel => {
      const text = clean(panel.textContent).toLowerCase();
      return text.includes("spray") && getComputedStyle(panel).display !== "none";
    });

    if (sprayPanel) {
      sprayPanel.innerHTML = html;
    }
  }

  function installStyles() {
    if (document.getElementById("fixed-spray-style")) return;

    const style = document.createElement("style");
    style.id = "fixed-spray-style";
    style.textContent = `
      .slip-fixed-spray {
        width: 100%;
        border: 1px solid rgba(124,255,30,.28);
        border-radius: 18px;
        background: #06110d;
        overflow: hidden;
      }

      .spray-meta-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        color: #dfffea;
        background: #081510;
        border-bottom: 1px solid rgba(255,255,255,.08);
        font-size: 11px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: .08em;
      }

      .spray-meta-row strong {
        color: #78ff1e;
      }

      .spray-svg {
        display: block;
        width: 100%;
        height: min(62vh, 620px);
      }

      .spray-dot {
        stroke: rgba(255,255,255,.78);
        stroke-width: 2;
        opacity: .96;
      }

      .spray-dot.hr { fill: #ff4f6d; }
      .spray-dot.xbh { fill: #ffd34a; }
      .spray-dot.hit { fill: #00d6a3; }
      .spray-dot.out { fill: #63aaf2; }
      .spray-dot.bip { fill: #d8f7ff; }

      .spray-legend {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        padding: 10px 12px;
        border-top: 1px solid rgba(255,255,255,.08);
        color: #dfffea;
        font-size: 11px;
        font-weight: 900;
        background: #081510;
      }

      .spray-legend span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }

      .spray-legend b {
        width: 9px;
        height: 9px;
        border-radius: 999px;
        display: inline-block;
      }

      .spray-legend .hr { background: #ff4f6d; }
      .spray-legend .xbh { background: #ffd34a; }
      .spray-legend .hit { background: #00d6a3; }
      .spray-legend .out { background: #63aaf2; }
      .spray-legend .bip { background: #d8f7ff; }
    `;
    document.head.appendChild(style);
  }

  function captureClick(event) {
    const card = event.target.closest("button, article, .threat, .batter-card, .danger-batter, [data-player], [data-name]");

    if (card) {
      const lines = clean(card.innerText).split("\n").map(clean).filter(Boolean);
      const dataName = card.dataset?.player || card.dataset?.name || card.dataset?.playerName;

      if (dataName) lastPlayerName = dataName;
      else {
        const match = lines.find(line => findProfileByName(line));
        if (match) lastPlayerName = match;
      }
    }

    const text = clean(event.target.textContent).toLowerCase();

    if (text === "spray" || text.includes("spray")) {
      setTimeout(forceSpray, 50);
      setTimeout(forceSpray, 150);
      setTimeout(forceSpray, 400);
    }
  }

  function install() {
    installStyles();

    document.addEventListener("click", captureClick, true);

    const observer = new MutationObserver(() => {
      const activeSpray = Array.from(document.querySelectorAll("button, .tab, .profile-tab-btn"))
        .some(btn => btn.classList.contains("active") && clean(btn.textContent).toLowerCase().includes("spray"));

      if (activeSpray) {
        setTimeout(forceSpray, 100);
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    });
  }

  loadData().then(install);
})();
