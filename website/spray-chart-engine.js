(function () {
  const DATA_URL = "./data/player_spray_charts.json";
  let sprayData = null;

  function clean(value) {
    return String(value || "").trim();
  }

  function key(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  async function loadSprayData() {
    if (sprayData) return sprayData;

    const response = await fetch(DATA_URL + "?v=" + Date.now());
    sprayData = await response.json();

    return sprayData;
  }

  function findOpenPlayerName() {
    const selectors = [
      ".modal h1",
      ".modal h2",
      ".profile-modal h1",
      ".profile-modal h2",
      ".player-modal h1",
      ".player-modal h2",
      "[data-player-name]"
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (!node) continue;

      const value =
        node.dataset?.playerName ||
        node.textContent;

      if (clean(value)) return clean(value);
    }

    return "";
  }

  function getPlayerSpray(playerName) {
    if (!sprayData || !playerName) return null;

    if (sprayData[playerName]) return sprayData[playerName];

    const target = key(playerName);

    for (const [name, value] of Object.entries(sprayData)) {
      if (key(name) === target) return value;
    }

    return null;
  }

  function classifyPoint(point) {
    const type = clean(point.type || point.event || point.result).toLowerCase();

    if (type.includes("home") || type === "hr") return "hr";
    if (type.includes("double") || type === "2b") return "xbh";
    if (type.includes("triple") || type === "3b") return "xbh";
    if (type.includes("single") || type === "1b") return "hit";
    if (type.includes("out")) return "out";

    return "bip";
  }

  function normalizePoint(point) {
    const rawX = Number(point.x ?? point.hc_x ?? point.hitX ?? point.coordX);
    const rawY = Number(point.y ?? point.hc_y ?? point.hitY ?? point.coordY);

    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
      return null;
    }

    const plateX = 125;
    const plateY = 205;

    const dx = rawX - plateX;
    const dy = plateY - rawY;

    const angle = Math.atan2(dx, dy);
    const distance = Math.sqrt(dx * dx + dy * dy);

    const scaledDistance = Math.min(245, distance * 1.55);

    const centerX = 500;
    const plateSvgY = 910;

    const x = centerX + Math.sin(angle) * scaledDistance * 1.55;
    const y = plateSvgY - Math.cos(angle) * scaledDistance * 1.55;

    return {
      x: Math.max(40, Math.min(960, x)),
      y: Math.max(70, Math.min(920, y)),
      cls: classifyPoint(point),
      label: clean(point.event || point.type || "BIP"),
      distance: clean(point.distance || point.hitDistance || ""),
      ev: clean(point.launchSpeed || point.exitVelocity || ""),
      la: clean(point.launchAngle || ""),
      date: clean(point.date || "")
    };
  }

  function renderSpraySvg(points) {
    const normalized = points
      .map(normalizePoint)
      .filter(Boolean);

    return `
      <div class="slip-spray-card">
        <svg class="slip-spray-svg" viewBox="0 0 1000 940" role="img" aria-label="Spray chart">
          <defs>
            <radialGradient id="fieldGlow" cx="50%" cy="92%" r="80%">
              <stop offset="0%" stop-color="rgba(120,255,30,.18)" />
              <stop offset="58%" stop-color="rgba(120,255,30,.08)" />
              <stop offset="100%" stop-color="rgba(120,255,30,0)" />
            </radialGradient>
          </defs>

          <rect x="0" y="0" width="1000" height="940" rx="22" fill="#06110d" />

          <path
            d="M500 900 L155 305 Q500 110 845 305 Z"
            fill="url(#fieldGlow)"
            stroke="rgba(120,255,30,.65)"
            stroke-width="3"
          />

          <line x1="500" y1="900" x2="500" y2="105" stroke="rgba(255,255,255,.18)" stroke-width="2" />
          <line x1="500" y1="900" x2="255" y2="335" stroke="rgba(255,255,255,.16)" stroke-width="3" />
          <line x1="500" y1="900" x2="745" y2="335" stroke="rgba(255,255,255,.16)" stroke-width="3" />

          <path d="M500 900 L455 855 L500 810 L545 855 Z" fill="#f5fff8" opacity=".95" />

          <path d="M325 610 Q500 515 675 610" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="2" />
          <path d="M255 430 Q500 310 745 430" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="2" />
          <path d="M190 305 Q500 140 810 305" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="2" />

          ${normalized.map(point => `
            <circle
              class="slip-spray-dot ${point.cls}"
              cx="${point.x.toFixed(1)}"
              cy="${point.y.toFixed(1)}"
              r="${point.cls === "hr" ? 13 : point.cls === "xbh" ? 10 : 8}"
            >
              <title>${point.label}${point.distance ? " • " + point.distance + " ft" : ""}${point.ev ? " • " + point.ev + " EV" : ""}${point.la ? " • " + point.la + " LA" : ""}${point.date ? " • " + point.date : ""}</title>
            </circle>
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

  async function replaceSprayChart() {
    await loadSprayData();

    const playerName = findOpenPlayerName();
    const playerSpray = getPlayerSpray(playerName);

    if (!playerSpray) return;

    const points = Array.isArray(playerSpray.points) ? playerSpray.points : [];

    const sprayHeaders = Array.from(document.querySelectorAll("h3, h2, .section-title, .tab-title"))
      .filter(node => clean(node.textContent).toLowerCase().includes("spray"));

    const oldContainers = Array.from(document.querySelectorAll(
      ".spray-field, .spray-wrap, .spray-profile, [data-spray-chart]"
    ));

    let target = oldContainers[0];

    if (!target && sprayHeaders[0]) {
      target = sprayHeaders[0].nextElementSibling;
    }

    if (!target) return;

    target.outerHTML = renderSpraySvg(points);
  }

  function installStyles() {
    if (document.getElementById("slip-spray-engine-style")) return;

    const style = document.createElement("style");
    style.id = "slip-spray-engine-style";
    style.textContent = `
      .slip-spray-card {
        width: 100%;
        border: 1px solid rgba(120,255,30,.25);
        border-radius: 18px;
        background: #06110d;
        overflow: hidden;
      }

      .slip-spray-svg {
        display: block;
        width: 100%;
        height: min(62vh, 620px);
      }

      .slip-spray-dot {
        stroke: rgba(255,255,255,.75);
        stroke-width: 2;
        opacity: .96;
      }

      .slip-spray-dot.hr {
        fill: #ff4f6d;
      }

      .slip-spray-dot.xbh {
        fill: #ffd34a;
      }

      .slip-spray-dot.hit {
        fill: #00d6a3;
      }

      .slip-spray-dot.out {
        fill: #63aaf2;
      }

      .slip-spray-dot.bip {
        fill: #d8f7ff;
      }

      .slip-spray-legend {
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

      .slip-spray-legend span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }

      .slip-spray-legend b {
        width: 9px;
        height: 9px;
        border-radius: 999px;
        display: inline-block;
      }

      .slip-spray-legend .hr { background: #ff4f6d; }
      .slip-spray-legend .xbh { background: #ffd34a; }
      .slip-spray-legend .hit { background: #00d6a3; }
      .slip-spray-legend .out { background: #63aaf2; }
      .slip-spray-legend .bip { background: #d8f7ff; }
    `;

    document.head.appendChild(style);
  }

  function observeModal() {
    const observer = new MutationObserver(() => {
      const visibleModal = document.querySelector(".profile-modal.show, .modal.show, [aria-hidden='false']");
      const sprayActive = Array.from(document.querySelectorAll("button, .profile-tab-btn, .tab"))
        .some(btn => btn.classList.contains("active") && clean(btn.textContent).toLowerCase().includes("spray"));

      if (visibleModal && sprayActive) {
        replaceSprayChart().catch(console.error);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-hidden"]
    });

    document.addEventListener("click", event => {
      const text = clean(event.target.textContent).toLowerCase();

      if (text.includes("spray")) {
        setTimeout(() => replaceSprayChart().catch(console.error), 60);
      }
    }, true);
  }

  installStyles();
  observeModal();
})();
