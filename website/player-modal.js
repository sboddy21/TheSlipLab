const modalRootId = "sl-player-modal-root";

function ensurePlayerModal() {
  let existing = document.getElementById(modalRootId);

  if (existing) return existing;

  const modal = document.createElement("div");
  modal.id = modalRootId;

  modal.innerHTML = `
    <div class="sl-player-modal-overlay" onclick="closePlayerModal()"></div>

    <div class="sl-player-modal">
      <button class="sl-player-modal-close" onclick="closePlayerModal()">×</button>
      <div id="sl-player-modal-content"></div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function closePlayerModal() {
  const modal = document.getElementById(modalRootId);
  if (modal) modal.classList.remove("active");
}

function openPlayerModal(row = {}) {
  const modal = ensurePlayerModal();

  const player = row.player || "Unknown Player";
  const team = row.team || "";
  const opponent = row.opponent || "";
  const pitcher = row.pitcher || "Unknown Pitcher";
  const weather = row.weather_label || "Neutral";
  const headshot = row.headshot || "";

  const hrScore = Number(row.hr_score || row.score || 0);
  const iso = Number(row.iso || 0).toFixed(3);
  const slg = Number(row.slg || 0).toFixed(3);
  const hardHit = Number(row.hard_hit_rate || 0).toFixed(1);
  const barrel = Number(row.barrel_rate || 0).toFixed(1);

  document.getElementById("sl-player-modal-content").innerHTML = `
    <div class="sl-player-hero">
      <div class="sl-player-hero-left">
        ${headshot ? `<img src="${headshot}" class="sl-player-headshot">` : ""}
        <div>
          <div class="sl-player-name">${player}</div>
          <div class="sl-player-subtitle">${team} vs ${opponent}</div>
          <div class="sl-player-matchup">vs ${pitcher}</div>
        </div>
      </div>
      <div class="sl-player-score">${hrScore}</div>
    </div>

    <div class="sl-player-stat-grid">
      ${buildStatBox("ISO", iso)}
      ${buildStatBox("SLG", slg)}
      ${buildStatBox("Hard Hit %", hardHit + "%")}
      ${buildStatBox("Barrel %", barrel + "%")}
      ${buildStatBox("Weather", weather)}
    </div>

    <div class="sl-player-tabs">
      <button class="sl-tab active">Profile</button>
      <button class="sl-tab">Matchup</button>
      <button class="sl-tab">Weather</button>
      <button class="sl-tab">Pitcher</button>
      <button class="sl-tab">Recent</button>
    </div>

    <div class="sl-player-zone-section">
      <div class="sl-zone-title">Simulated Power Zones</div>
      <div class="sl-zone-grid">
        ${buildZoneCell("")}
        ${buildZoneCell("hot")}
        ${buildZoneCell("")}
        ${buildZoneCell("warm")}
        ${buildZoneCell("")}
        ${buildZoneCell("")}
        ${buildZoneCell("warm")}
        ${buildZoneCell("hot")}
        ${buildZoneCell("")}
        ${buildZoneCell("")}
        ${buildZoneCell("")}
        ${buildZoneCell("")}
        ${buildZoneCell("warm")}
        ${buildZoneCell("")}
        ${buildZoneCell("")}
        ${buildZoneCell("")}
        ${buildZoneCell("")}
        ${buildZoneCell("")}
        ${buildZoneCell("hot")}
        ${buildZoneCell("")}
        ${buildZoneCell("")}
        ${buildZoneCell("")}
        ${buildZoneCell("")}
        ${buildZoneCell("")}
        ${buildZoneCell("warm")}
      </div>
    </div>
  `;

  modal.classList.add("active");
}

function buildStatBox(label, value) {
  return `
    <div class="sl-stat-box">
      <div class="sl-stat-label">${label}</div>
      <div class="sl-stat-value">${value}</div>
    </div>
  `;
}

function buildZoneCell(type = "") {
  return `<div class="sl-zone-cell ${type}"></div>`;
}

window.openPlayerModal = openPlayerModal;
window.closePlayerModal = closePlayerModal;
