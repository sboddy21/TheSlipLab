(function(){
  let cache = null;

  const esc = v => String(v ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));

  const num = v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  async function loadData(){
    if(cache) return cache;
    const stamp = Date.now();

    const safe = async url => {
      try { return await (await fetch(url + "?v=" + stamp)).json(); }
      catch { return {}; }
    };

    cache = {
      trust: await safe("/data/ai_trust_engine.json"),
      hof: await safe("/data/hr_ai_hof.json"),
      today: await safe("/data/hr_ai_breakdowns.json")
    };

    return cache;
  }

  function allHofCalls(hof){
    return [
      ...(hof.bestCalls || []),
      ...(hof.valueHits || []),
      ...(hof.longshots || hof.longshotLegends || [])
    ];
  }

  function findToday(data, player){
    return Object.values(data.today.players || {}).find(r => String(r.player) === String(player)) || {};
  }

  function findTrust(data, player){
    return data.trust.byPlayer?.[player] || {};
  }

  function findHof(data, player){
    return allHofCalls(data.hof).filter(r => String(r.player) === String(player));
  }

  function bars(b){
    const items = [
      ["⚡ Power", b.power],
      ["🎯 Matchup", b.matchup],
      ["🧬 Pitch Mix", b.pitchMix],
      ["🌤 Environment", b.environment],
      ["🤝 Consensus", b.consensus],
      ["📈 Trend", b.trend]
    ];

    return items.map(([label,val])=>`
      <div class="aipp-line">
        <span>${label}</span>
        <div><i style="width:${Math.max(0, Math.min(100, num(val)))}%"></i></div>
        <b>${Math.round(num(val))}</b>
      </div>
    `).join("");
  }

  function html(player, data){
    const today = findToday(data, player);
    const trust = findTrust(data, player);
    const calls = findHof(data, player);
    const best = [...calls].sort((a,b)=>num(a.rank)-num(b.rank))[0] || {};
    const longest = [...calls].sort((a,b)=>num(b.distance)-num(a.distance))[0] || {};
    const headshot = today.headshot || trust.headshot || best.headshot || "";

    return `
      <div class="aipp-head">
        <div class="aipp-avatar">${headshot ? `<img src="${esc(headshot)}" alt="">` : esc(String(player).slice(0,1))}</div>
        <div>
          <span>AI PLAYER PROFILE</span>
          <h2>${esc(player)}</h2>
          <p>${esc(today.team || trust.team || best.team || "")}${today.opponent ? " vs " + esc(today.opponent) : ""}</p>
        </div>
      </div>

      <div class="aipp-stats">
        <div><span>Trust Score</span><b>${esc(trust.trustScore || "-")}</b></div>
        <div><span>Today's Grade</span><b>${esc(today.grade || trust.grade || "-")}</b></div>
        <div><span>Today's Rank</span><b>#${esc(today.rank || trust.rank || "-")}</b></div>
        <div><span>HOF Hits</span><b>${calls.length}</b></div>
        <div><span>Best HOF Rank</span><b>#${esc(best.rank || "-")}</b></div>
        <div><span>Longest HR</span><b>${esc(longest.distance || "-")} ft</b></div>
      </div>

      <div class="aipp-card">
        <h3>AI Trust Engine</h3>
        <p>${esc(trust.summary || today.analystTake || today.summary || "No AI summary available yet.")}</p>
        <div class="aipp-bars">${bars(trust.breakdown || {})}</div>
      </div>

      <div class="aipp-card">
        <h3>Hall of Fame Timeline</h3>
        ${calls.length ? calls.slice(0,8).map(r=>`
          <div class="aipp-row">
            <span>${esc(r.date || "-")}</span>
            <b>${esc(r.grade || "B")} • Rank #${esc(r.rank || "-")}</b>
            <em>${esc(r.distance || "-")} ft</em>
            <small>vs ${esc(r.pitcher || "TBD")}</small>
          </div>
        `).join("") : `<p>No Hall of Fame hits recorded yet.</p>`}
      </div>
    `;
  }

  function ensureModal(){
    if(document.getElementById("aiPlayerProfileModal")) return;

    document.body.insertAdjacentHTML("beforeend", `
      <div class="aipp-modal" id="aiPlayerProfileModal">
        <div class="aipp-box">
          <button class="aipp-close" id="aiPlayerProfileClose">×</button>
          <div id="aiPlayerProfileContent"></div>
        </div>
      </div>
    `);

    const css = document.createElement("style");
    css.textContent = `
      .aipp-modal{position:fixed;inset:0;z-index:999;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.76);backdrop-filter:blur(10px)}
      .aipp-modal.open{display:flex}
      .aipp-box{width:min(920px,94vw);max-height:88vh;overflow:auto;padding:22px;border-radius:24px;background:linear-gradient(135deg,#08140e,#050706);border:1px solid rgba(143,255,45,.42);box-shadow:0 0 52px rgba(143,255,45,.18);position:relative;color:white}
      .aipp-close{position:absolute;right:12px;top:12px;width:34px;height:34px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:white;font-size:22px;cursor:pointer}
      .aipp-head{display:flex;align-items:center;gap:14px}
      .aipp-avatar{width:78px;height:78px;border-radius:999px;background:#07110d;color:#8fff2d;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:1000;overflow:hidden}
      .aipp-avatar img{width:100%;height:100%;object-fit:cover}
      .aipp-head span{color:#8fff2d;font-size:11px;letter-spacing:1.6px;font-weight:1000}
      .aipp-head h2{margin:5px 0 2px;font-size:36px}
      .aipp-head p{margin:0;color:rgba(255,255,255,.62);font-weight:850}
      .aipp-stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:18px 0}
      .aipp-stats div,.aipp-card{border-radius:16px;background:rgba(143,255,45,.06);border:1px solid rgba(143,255,45,.16)}
      .aipp-stats div{padding:12px}
      .aipp-stats span{display:block;color:rgba(255,255,255,.52);font-size:9px;font-weight:1000;letter-spacing:.8px;text-transform:uppercase}
      .aipp-stats b{display:block;margin-top:5px;color:#8fff2d;font-size:22px}
      .aipp-card{padding:14px;margin-top:12px}
      .aipp-card h3{margin:0 0 8px}
      .aipp-card p{color:rgba(255,255,255,.78);line-height:1.5;font-weight:750}
      .aipp-line{display:grid;grid-template-columns:115px 1fr 36px;gap:8px;align-items:center;margin:7px 0}
      .aipp-line span{font-size:12px;font-weight:1000;color:rgba(255,255,255,.70)}
      .aipp-line div{height:8px;border-radius:999px;background:rgba(255,255,255,.10);overflow:hidden}
      .aipp-line i{display:block;height:100%;background:linear-gradient(90deg,#8fff2d,#10f29a)}
      .aipp-line b{font-size:12px;text-align:right}
      .aipp-row{display:grid;grid-template-columns:90px 130px 80px 1fr;gap:10px;align-items:center;padding:10px;border-radius:13px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);margin-top:8px}
      .aipp-row span,.aipp-row small{color:rgba(255,255,255,.58);font-size:11px;font-weight:900}
      .aipp-row em{color:#8fff2d;font-style:normal;font-weight:1000}
      .ai-profile-chip,.ai-profile-btn{cursor:pointer}
      @media(max-width:900px){.aipp-stats{grid-template-columns:repeat(2,1fr)}.aipp-row{grid-template-columns:1fr}}
    `;
    document.head.appendChild(css);

    document.getElementById("aiPlayerProfileClose").onclick = close;
    document.getElementById("aiPlayerProfileModal").onclick = e => {
      if(e.target.id === "aiPlayerProfileModal") close();
    };
  }

  async function open(player){
    ensureModal();
    const data = await loadData();
    document.getElementById("aiPlayerProfileContent").innerHTML = html(player, data);
    document.getElementById("aiPlayerProfileModal").classList.add("open");
  }

  function close(){
    document.getElementById("aiPlayerProfileModal")?.classList.remove("open");
  }

  document.addEventListener("click", e=>{
    const target = e.target.closest("[data-ai-profile-player]");
    if(!target) return;
    e.preventDefault();
    e.stopPropagation();
    open(target.dataset.aiProfilePlayer);
  });

  window.openAIPlayerProfile = open;
})();
