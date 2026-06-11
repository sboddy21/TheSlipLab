(function () {
  const CSS = `
  .sl-health-widget{
    position:fixed;top:14px;right:14px;z-index:99999;
    font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  }
  .sl-health-pill{
    cursor:pointer;border:1px solid rgba(255,255,255,.16);
    background:rgba(8,14,24,.88);backdrop-filter:blur(14px);
    color:white;border-radius:16px;padding:9px 12px;min-width:126px;
    box-shadow:0 14px 40px rgba(0,0,0,.38),0 0 28px rgba(80,255,150,.10);
  }
  .sl-health-top{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:1000;letter-spacing:.08em}
  .sl-dot{width:9px;height:9px;border-radius:999px;background:#25ff7a;box-shadow:0 0 14px #25ff7a}
  .sl-health-sub{margin-top:3px;font-size:10px;color:rgba(255,255,255,.68);font-weight:800}
  .sl-health-widget:hover .sl-health-tip{opacity:1;transform:translateY(0);pointer-events:auto}
  .sl-health-tip{
    position:absolute;right:0;top:58px;width:210px;opacity:0;pointer-events:none;
    transform:translateY(-4px);transition:.18s ease;
    border:1px solid rgba(255,255,255,.14);border-radius:16px;
    background:rgba(8,14,24,.94);backdrop-filter:blur(14px);
    color:white;padding:12px;box-shadow:0 18px 50px rgba(0,0,0,.45);
    font-size:12px;font-weight:800;
  }
  .sl-health-tip div{display:flex;justify-content:space-between;margin:5px 0;color:rgba(255,255,255,.78)}
  .sl-health-tip b{color:white}
  .sl-health-modal-backdrop{
    position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.62);
    display:none;align-items:center;justify-content:center;padding:18px;
  }
  .sl-health-modal{
    width:min(520px,100%);border-radius:24px;border:1px solid rgba(255,255,255,.16);
    background:linear-gradient(180deg,rgba(16,24,38,.98),rgba(7,11,20,.98));
    color:white;padding:20px;box-shadow:0 25px 90px rgba(0,0,0,.62);
  }
  .sl-health-modal h3{margin:0 0 4px;font-size:20px}
  .sl-health-modal p{margin:0 0 14px;color:rgba(255,255,255,.65);font-size:12px;font-weight:800}
  .sl-health-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
  .sl-health-card{border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:12px;background:rgba(255,255,255,.045)}
  .sl-health-card small{display:block;color:rgba(255,255,255,.58);font-size:10px;font-weight:900;text-transform:uppercase}
  .sl-health-card strong{display:block;margin-top:4px;font-size:20px}
  .sl-health-close{margin-top:14px;width:100%;border:0;border-radius:14px;padding:11px;background:#93ff2d;color:#07110a;font-weight:1000;cursor:pointer}
  @media(max-width:700px){.sl-health-widget{top:10px;right:10px}.sl-health-pill{min-width:108px;padding:8px 10px}.sl-health-grid{grid-template-columns:1fr}}
  `;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "sl-health-widget";
  root.innerHTML = `
    <div class="sl-health-pill" id="slHealthPill">
      <div class="sl-health-top"><span class="sl-dot"></span><span>MLB LIVE</span></div>
      <div class="sl-health-sub" id="slHealthSub">Checking...</div>
    </div>
    <div class="sl-health-tip" id="slHealthTip"></div>
  `;
  document.body.appendChild(root);

  const modal = document.createElement("div");
  modal.className = "sl-health-modal-backdrop";
  modal.id = "slHealthModal";
  document.body.appendChild(modal);

  function ago(iso) {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "Updated recently";
    const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 1) return "Updated now";
    if (mins === 1) return "Updated 1m ago";
    if (mins < 60) return `Updated ${mins}m ago`;
    return `Updated ${Math.round(mins / 60)}h ago`;
  }

  function statusText(data) {
    if (!data || data.status !== "healthy") return "Needs check";
    return "All Systems Operational";
  }

  async function loadHealth() {
    try {
      const res = await fetch("./data/health_status.json?ts=" + Date.now());
      const data = await res.json();
      const c = data.checks || {};

      document.getElementById("slHealthSub").textContent = ago(data.updatedAt);
      document.getElementById("slHealthTip").innerHTML = `
        <div><span>Players</span><b>${c.players || 0}</b></div>
        <div><span>Games</span><b>${c.games || 0}</b></div>
        <div><span>HR Results</span><b>${c.results || 0}</b></div>
        <div><span>Status</span><b>${statusText(data)}</b></div>
      `;

      document.getElementById("slHealthPill").onclick = () => {
        modal.style.display = "flex";
        modal.innerHTML = `
          <div class="sl-health-modal">
            <h3>MLB Health Dashboard</h3>
            <p>${ago(data.updatedAt)} • ${statusText(data)}</p>
            <div class="sl-health-grid">
              <div class="sl-health-card"><small>Games</small><strong>${c.games || 0}</strong></div>
              <div class="sl-health-card"><small>Players</small><strong>${c.players || 0}</strong></div>
              <div class="sl-health-card"><small>HR Board</small><strong>${c.hrBoard || 0}</strong></div>
              <div class="sl-health-card"><small>Matchups</small><strong>${c.matchups || 0}</strong></div>
              <div class="sl-health-card"><small>Decision Center</small><strong>${c.decisionCenter || 0}</strong></div>
              <div class="sl-health-card"><small>HR Results</small><strong>${c.results || 0}</strong></div>
            </div>
            <button class="sl-health-close" id="slHealthClose">Close</button>
          </div>
        `;
        document.getElementById("slHealthClose").onclick = () => modal.style.display = "none";
      };
    } catch {
      document.getElementById("slHealthSub").textContent = "Needs check";
    }
  }

  modal.addEventListener("click", e => {
    if (e.target === modal) modal.style.display = "none";
  });

  loadHealth();
  setInterval(loadHealth, 60000);
})();
