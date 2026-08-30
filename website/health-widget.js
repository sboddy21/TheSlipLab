(function () {
  const nflPage = document.body?.classList.contains("tsl-nfl-page") || window.location.pathname === "/nfl.html";
  const CSS = `
  .sl-health-widget{
    --sl-state:#25ff7a;--sl-state-soft:rgba(37,255,122,.14);
    position:static;z-index:100000;flex:0 0 auto;margin-left:auto;visibility:hidden;
    font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  }
  .sl-health-widget[data-docked="true"]{visibility:visible}
  .sl-health-widget[data-state="closed"]{--sl-state:#8db6ff;--sl-state-soft:rgba(141,182,255,.16)}
  .sl-health-widget[data-state="updating"]{--sl-state:#48d7ff;--sl-state-soft:rgba(72,215,255,.16)}
  .sl-health-widget[data-state="delayed"]{--sl-state:#ffb323;--sl-state-soft:rgba(255,179,35,.17)}
  .sl-health-widget[data-state="check"]{--sl-state:#ff5b57;--sl-state-soft:rgba(255,91,87,.17)}
  .sl-health-pill{
    display:flex;align-items:center;gap:9px;
    cursor:pointer;border:1px solid color-mix(in srgb,var(--sl-state) 42%,transparent);
    background:rgba(8,14,24,.92);backdrop-filter:blur(14px);
    color:#fff;border-radius:999px;padding:5px 10px;min-width:0;min-height:28px;
    box-shadow:0 8px 22px rgba(0,0,0,.28),0 0 20px var(--sl-state-soft);
  }
  .sl-health-top{display:flex;align-items:center;gap:7px;font-size:10px;font-weight:1000;letter-spacing:.08em;white-space:nowrap}
  .sl-dot{width:7px;height:7px;border-radius:999px;background:var(--sl-state);box-shadow:0 0 12px var(--sl-state)}
  .sl-health-sub{margin:0;padding-left:9px;border-left:1px solid rgba(255,255,255,.16);font-size:9px;color:rgba(255,255,255,.78);font-weight:800;white-space:nowrap}
  .sl-health-widget:hover .sl-health-tip{opacity:1;transform:translateY(0);pointer-events:auto}
  .sl-health-tip{
    position:absolute;right:0;top:36px;width:238px;opacity:0;pointer-events:none;
    transform:translateY(-4px);transition:.18s ease;
    border:1px solid rgba(255,255,255,.14);border-radius:16px;
    background:rgba(8,14,24,.96);backdrop-filter:blur(14px);
    color:#fff;padding:12px;box-shadow:0 18px 50px rgba(0,0,0,.45);
    font-size:12px;font-weight:800;
  }
  .sl-health-tip div{display:flex;justify-content:space-between;gap:14px;margin:6px 0;color:rgba(255,255,255,.76)}
  .sl-health-tip b{color:#fff;text-align:right}
  .sl-health-modal-backdrop{
    position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.68);
    display:none;align-items:center;justify-content:center;padding:18px;
  }
  .sl-health-modal{
    width:min(720px,100%);max-height:min(820px,92vh);overflow:auto;border-radius:24px;
    border:1px solid rgba(255,255,255,.16);
    background:linear-gradient(180deg,rgba(16,24,38,.99),rgba(7,11,20,.99));
    color:#fff;padding:20px;box-shadow:0 25px 90px rgba(0,0,0,.62);
  }
  .sl-health-modal h3{margin:0 0 4px;font-size:20px;color:#fff}
  .sl-health-modal p{margin:0 0 14px;color:rgba(255,255,255,.7);font-size:12px;font-weight:800}
  .sl-health-banner{border:1px solid color-mix(in srgb,var(--sl-state) 42%,transparent);background:var(--sl-state-soft);border-radius:14px;padding:11px 12px;margin-bottom:14px;font-size:12px;font-weight:900;color:#fff}
  .sl-health-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .sl-health-card{border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:12px;background:rgba(255,255,255,.045)}
  .sl-health-card small{display:block;color:rgba(255,255,255,.62);font-size:10px;font-weight:900;text-transform:uppercase}
  .sl-health-card strong{display:block;margin-top:4px;font-size:20px;color:#fff}
  .sl-health-artifacts{margin-top:14px;border:1px solid rgba(255,255,255,.1);border-radius:16px;overflow:hidden}
  .sl-health-artifact{display:grid;grid-template-columns:minmax(150px,1fr) 90px 110px;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);font-size:11px;align-items:center}
  .sl-health-artifact:last-child{border-bottom:0}.sl-health-artifact span{color:rgba(255,255,255,.72)}
  .sl-health-artifact strong{color:#fff;overflow-wrap:anywhere}.sl-health-fresh{color:var(--sl-state)!important;text-align:right;text-transform:uppercase}
  .sl-health-errors{margin-top:12px;padding:10px 12px;border:1px solid rgba(255,91,87,.35);border-radius:14px;background:rgba(255,91,87,.1);font-size:11px;color:#ffd2d0}
  .sl-health-close{margin-top:14px;width:100%;border:0;border-radius:14px;padding:11px;background:var(--sl-state);color:#07110a;font-weight:1000;cursor:pointer}
  @media(max-width:1180px){.sl-health-sub{display:none}}
  @media(max-width:900px){.tsl-site-header-inner{position:relative}.sl-health-widget{position:absolute;top:8px;right:12px;margin:0}.tsl-site-header-inner>.tsl-brand{padding-right:118px}.sl-health-pill{min-height:24px;padding:3px 8px}.sl-health-top{font-size:9px}.sl-health-tip{top:31px;bottom:auto}.sl-health-grid{grid-template-columns:repeat(2,1fr)}.sl-health-artifact{grid-template-columns:1fr 72px}.sl-health-artifact span:nth-child(2){display:none}}
  `;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "sl-health-widget";
  root.dataset.state = "updating";
  root.innerHTML = `
    <div class="sl-health-pill" id="slHealthPill" role="button" tabindex="0" aria-label="Open ${nflPage ? "NFL" : "MLB"} production status">
      <div class="sl-health-top"><span class="sl-dot"></span><span id="slHealthLabel">${nflPage ? "NFL BUILDING" : "MLB UPDATING"}</span></div>
      <div class="sl-health-sub" id="slHealthSub">Checking production data...</div>
    </div>
    <div class="sl-health-tip" id="slHealthTip"></div>
  `;
  document.body.appendChild(root);

  function dockInHeader(){
    const headerInner = document.querySelector(".tsl-site-header-inner");
    if (!headerInner) return false;
    headerInner.appendChild(root);
    root.dataset.docked = "true";
    return true;
  }

  if (!dockInHeader()) {
    const headerObserver = new MutationObserver(() => {
      if (dockInHeader()) headerObserver.disconnect();
    });
    headerObserver.observe(document.body, { childList: true });
    window.addEventListener("DOMContentLoaded", dockInHeader, { once: true });
  }

  const modal = document.createElement("div");
  modal.className = "sl-health-modal-backdrop";
  modal.id = "slHealthModal";
  document.body.appendChild(modal);

  const stateCopy = {
    live: "Current production slate is verified.",
    closed: "No MLB games are scheduled for the current slate.",
    updating: "The production refresh is currently updating.",
    delayed: "The last verified refresh is outside the production window.",
    check: "Production data needs attention before it is treated as current."
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function ago(iso) {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "No verified update time";
    const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
    if (mins < 1) return "Updated now";
    if (mins === 1) return "Updated 1m ago";
    if (mins < 60) return `Updated ${mins}m ago`;
    return `Updated ${Math.floor(mins / 60)}h ago`;
  }

  function resolveState(data) {
    const declared = String(data?.monitoring?.state || "").toLowerCase();
    if (declared === "check" || data?.status === "error") return "check";
    if (declared === "delayed" || data?.status === "delayed") return "delayed";

    const freshUntil = Date.parse(data?.monitoring?.freshUntil);
    if (["live", "closed", "updating"].includes(declared) && Number.isFinite(freshUntil) && Date.now() > freshUntil) {
      return "delayed";
    }
    if (declared === "updating") return "updating";
    if (declared === "closed" || data?.label === "CLOSED") return "closed";
    if (declared === "live" && data?.status === "healthy") return "live";
    return "check";
  }

  function artifactRows(data) {
    return Object.values(data?.artifacts || {}).map(artifact => {
      const freshness = artifact.freshness === "current" ? "current" : artifact.freshness || "check";
      return `
        <div class="sl-health-artifact">
          <strong>${escapeHtml(artifact.file || "Artifact")}</strong>
          <span>${escapeHtml(ago(artifact.timestamp).replace("Updated ", ""))}</span>
          <strong class="sl-health-fresh">${escapeHtml(freshness.replaceAll("_", " "))}</strong>
        </div>`;
    }).join("");
  }

  function render(data) {
    if (nflPage) {
      const c = data.counts || {};
      const s = data.sources || {};
      const audit = s.launchAudit || {};
      const state = Number(audit.criticalIdentityIssues) > 0 ? "check" : (Number(audit.blockerCount) > 0 ? "updating" : "live");
      const stateLabel = state === "updating" ? "BUILDING" : state.toUpperCase();
      const updateTime = audit.checkedAt || data.generatedAt;
      root.dataset.state = state;
      document.getElementById("slHealthLabel").textContent = `NFL ${stateLabel}`;
      document.getElementById("slHealthSub").textContent = ago(updateTime);
      document.getElementById("slHealthTip").innerHTML = `
        <div><span>Week 1 games</span><b>${Number(c.weekOneGames) || 0}</b></div>
        <div><span>Players</span><b>${Number(c.eligiblePlayers) || 0}</b></div>
        <div><span>Weather</span><b>${Number(s.weather?.readyGames) || 0}/${Number(s.weather?.games) || 0} ready</b></div>
        <div><span>Status</span><b>${stateLabel}</b></div>
      `;
      const openModal = () => {
        const issues = [
          s.practiceReports?.status === "waiting_for_official_weekly_reports" ? "Official Week 1 practice reports are pending." : "",
          Number(s.weather?.readyGames) < Number(s.weather?.games) ? `${Number(s.weather?.games) - Number(s.weather?.readyGames)} game still needs kickoff-hour weather.` : "",
          s.routes?.status === "unavailable" ? "Verified route participation is not available yet." : ""
        ].filter(Boolean);
        modal.style.display = "flex";
        modal.innerHTML = `
          <div class="sl-health-modal">
            <h3>NFL Build Status</h3>
            <p>Week 1 • ${escapeHtml(ago(updateTime))}</p>
            <div class="sl-health-banner">${escapeHtml(stateLabel)} — NFL data gates remain visible while the member preview is reviewed.</div>
            <div class="sl-health-grid">
              <div class="sl-health-card"><small>Teams</small><strong>${Number(c.teams) || 0}</strong></div>
              <div class="sl-health-card"><small>Week 1 Games</small><strong>${Number(c.weekOneGames) || 0}</strong></div>
              <div class="sl-health-card"><small>Players</small><strong>${Number(c.eligiblePlayers) || 0}</strong></div>
              <div class="sl-health-card"><small>Weather Ready</small><strong>${Number(s.weather?.readyGames) || 0}/${Number(s.weather?.games) || 0}</strong></div>
              <div class="sl-health-card"><small>TD Signals</small><strong>${Number(s.tdDecisionCenter?.rankedPlayers) || 0}</strong></div>
              <div class="sl-health-card"><small>Rec Signals</small><strong>${Number(s.receivingYards?.rankedPlayers) || 0}</strong></div>
            </div>
            ${issues.length ? `<div class="sl-health-errors">${issues.map(escapeHtml).join("<br>")}</div>` : ""}
            <button class="sl-health-close" id="slHealthClose">Close</button>
          </div>`;
        document.getElementById("slHealthClose").onclick = () => modal.style.display = "none";
      };
      const pill = document.getElementById("slHealthPill");
      pill.onclick = openModal;
      pill.onkeydown = event => {
        if (event.key === "Enter" || event.key === " ") openModal();
      };
      return;
    }
    const state = resolveState(data);
    const c = data.checks || {};
    const stateLabel = state.toUpperCase();
    const updateTime = data.monitoring?.lastSuccessfulAt || data.updatedAt || data.generatedAt;
    root.dataset.state = state;
    document.getElementById("slHealthLabel").textContent = `MLB ${stateLabel}`;
    document.getElementById("slHealthSub").textContent = ago(updateTime);
    document.getElementById("slHealthTip").innerHTML = `
      <div><span>Slate</span><b>${escapeHtml(data.slateDate || "Not verified")}</b></div>
      <div><span>Games</span><b>${Number(c.games) || 0}</b></div>
      <div><span>Players</span><b>${Number(c.players) || 0}</b></div>
      <div><span>Status</span><b>${stateLabel}</b></div>
    `;

    const openModal = () => {
      const issues = [...(data.delays || []), ...(data.errors || [])];
      modal.style.display = "flex";
      modal.innerHTML = `
        <div class="sl-health-modal">
          <h3>MLB Production Status</h3>
          <p>${escapeHtml(data.slateDate || "Slate not verified")} • ${escapeHtml(ago(updateTime))}</p>
          <div class="sl-health-banner">${escapeHtml(stateLabel)} — ${escapeHtml(stateCopy[state])}</div>
          <div class="sl-health-grid">
            <div class="sl-health-card"><small>Games</small><strong>${Number(c.games) || 0}</strong></div>
            <div class="sl-health-card"><small>Players</small><strong>${Number(c.players) || 0}</strong></div>
            <div class="sl-health-card"><small>HR Board</small><strong>${Number(c.hrBoard) || 0}</strong></div>
            <div class="sl-health-card"><small>Matchups</small><strong>${Number(c.matchups) || 0}</strong></div>
            <div class="sl-health-card"><small>Decision Center</small><strong>${Number(c.decisionCenter) || 0}</strong></div>
            <div class="sl-health-card"><small>HR Results</small><strong>${Number(c.results) || 0}</strong></div>
          </div>
          <div class="sl-health-artifacts">${artifactRows(data) || '<div class="sl-health-artifact"><strong>Artifact details unavailable</strong><span></span><strong class="sl-health-fresh">CHECK</strong></div>'}</div>
          ${issues.length ? `<div class="sl-health-errors">${issues.map(escapeHtml).join("<br>")}</div>` : ""}
          <button class="sl-health-close" id="slHealthClose">Close</button>
        </div>
      `;
      document.getElementById("slHealthClose").onclick = () => modal.style.display = "none";
    };
    const pill = document.getElementById("slHealthPill");
    pill.onclick = openModal;
    pill.onkeydown = event => {
      if (event.key === "Enter" || event.key === " ") openModal();
    };
  }

  async function loadHealth() {
    try {
      const res = await fetch(`./data/${nflPage ? "nfl_data_health" : "health_status"}.json?ts=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Health request returned ${res.status}`);
      render(await res.json());
    } catch (error) {
      render({
        status: "error",
        label: "CHECK",
        monitoring: { state: "check" },
        errors: [error.message || "Production health status could not be loaded"]
      });
    }
  }

  modal.addEventListener("click", event => {
    if (event.target === modal) modal.style.display = "none";
  });

  loadHealth();
  setInterval(loadHealth, 60000);
})();
