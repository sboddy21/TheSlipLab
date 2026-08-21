(() => {
  const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const dec = value => Number.isFinite(Number(value)) ? Number(value).toFixed(3).replace(/^0/, "") : "—";
  const initials = name => String(name || "").trim().split(/\s+/).map(part => part[0] || "").join("").slice(0, 2).toUpperCase();
  const normalized = value => String(value || "").trim().toUpperCase();

  function batterHand(row) {
    const value = normalized(row.batSide || row.bats);
    if (["R", "RH", "RHB"].includes(value) || value.includes("RIGHT")) return "RHB";
    if (["L", "LH", "LHB"].includes(value) || value.includes("LEFT")) return "LHB";
    return "";
  }

  function pitcherHand(row) {
    const value = normalized(row.opposingPitcherHand || row.pitcherHand);
    if (["R", "RH", "RHP"].includes(value) || value.includes("RIGHT")) return "RHP";
    if (["L", "LH", "LHP"].includes(value) || value.includes("LEFT")) return "LHP";
    return "";
  }

  function eligible(row) {
    const status = normalized(row.lineupStatus || row.lineupSource).replace(/[\s-]+/g, "_");
    return status !== "NOT_IN_LINEUP" && Boolean(row.game) && Boolean(row.opposingPitcher);
  }

  function splitFor(row) {
    return pitcherHand(row) === "LHP" ? row.splits?.vsLhp : row.splits?.vsRhp;
  }

  function modelScore(row) {
    return num(row.hrConfidence ?? row.score ?? row.model?.score);
  }

  function edgeScore(row) {
    const split = splitFor(row) || {};
    const pa = num(split.pa);
    const reliability = Math.min(1, Math.sqrt(pa / 120));
    const production = (num(split.ops) * 52) + (num(split.slg) * 32) + (num(split.avg) * 10);
    return (production * (.55 + .45 * reliability)) + (modelScore(row) * .22);
  }

  function headshot(row) {
    const id = String(row.playerId || "").replace(/\D/g, "");
    const fallback = `<span aria-hidden="true">${esc(initials(row.player))}</span>`;
    if (!id) return fallback;
    const src = `https://img.mlbstatic.com/mlb-photos/image/upload/w_140,q_auto:best,f_auto/v1/people/${id}/headshot/67/current`;
    return `${fallback}<img src="${src}" alt="${esc(row.player)} headshot" loading="lazy" onerror="this.remove()">`;
  }

  function card(row, index) {
    const split = splitFor(row) || {};
    const score = edgeScore(row);
    const lineup = row.lineupSpot ? ` · ${normalized(row.lineupStatus).includes("CONFIRMED") ? "Confirmed" : "Projected"} #${row.lineupSpot}` : "";
    return `<button class="edge-card player-card" type="button" data-player-name="${esc(row.player)}" data-player-id="${esc(row.playerId || "")}">
      <span class="headshot">${headshot(row)}</span>
      <span><span class="edge-rank">#${index + 1} · Platoon advantage</span><strong class="edge-name">${esc(row.player)}</strong><span class="edge-matchup">${esc(row.team)} vs ${esc(row.opposingPitcher)} (${esc(pitcherHand(row))})${esc(lineup)}</span><span class="edge-stats"><span>${esc(split.pa || 0)} PA</span><span>${dec(split.avg)} AVG</span><span>${dec(split.slg)} SLG</span><span>${dec(split.ops)} OPS</span><span>${esc(split.hr || 0)} HR</span></span></span>
      <span class="edge-score"><b>${score.toFixed(1)}</b><small>Edge score</small></span>
    </button>`;
  }

  function renderList(id, rows) {
    document.getElementById(id).innerHTML = rows.length ? rows.slice(0, 20).map(card).join("") : `<div class="empty">No qualifying matchups are available yet.</div>`;
  }

  fetch("./data/player_card_data.json", { cache: "no-store" })
    .then(response => {
      if (!response.ok) throw new Error(`Player data returned ${response.status}`);
      return response.json();
    })
    .then(payload => {
      const players = Array.isArray(payload.players) ? payload.players : [];
      const ranked = players.filter(eligible).sort((a, b) => edgeScore(b) - edgeScore(a));
      renderList("rhbList", ranked.filter(row => batterHand(row) === "RHB" && pitcherHand(row) === "LHP"));
      renderList("lhbList", ranked.filter(row => batterHand(row) === "LHB" && pitcherHand(row) === "RHP"));
      const updated = payload.updatedAt ? new Date(payload.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Live data";
      document.getElementById("updated").textContent = `${players.length} player profiles · Updated ${updated}`;
    })
    .catch(error => {
      document.getElementById("updated").textContent = "Platoon data is temporarily unavailable.";
      renderList("rhbList", []);
      renderList("lhbList", []);
      console.error(error);
    });
})();
