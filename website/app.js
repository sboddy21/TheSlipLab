const state = {
  sport: "mlb",
  market: "home_runs"
};

const marketFiles = {
  mlb: {
    home_runs: "data/mlb_home_runs.json",
    hits: "data/mlb_hits.json",
    total_bases: "data/mlb_total_bases.json",
    rbis: "data/mlb_rbis.json"
  }
};

function titleCase(text) {
  return text.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
}

async function loadRows() {
  const file = marketFiles[state.sport]?.[state.market];

  if (!file) return [];

  try {
    const res = await fetch(file, { cache: "no-store" });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function render() {
  document.querySelectorAll("nav button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.sport === state.sport);
  });

  document.querySelectorAll(".tabs button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.market === state.market);
  });

  document.getElementById("page-title").textContent = `${state.sport.toUpperCase()} Lab`;

  document.getElementById("page-subtitle").textContent =
    state.sport === "mlb"
      ? "Home Runs, Hits, Total Bases, and RBIs."
      : "Coming soon.";

  const board = document.getElementById("board");
  board.innerHTML = `<div class="empty">Loading ${state.sport.toUpperCase()} ${titleCase(state.market)} data...</div>`;

  const rows = await loadRows();

  if (!rows.length) {
    board.innerHTML = `<div class="empty">${state.sport.toUpperCase()} ${titleCase(state.market)} data coming soon.</div>`;
    return;
  }

  board.innerHTML = rows.map((row, index) => `
    <article class="card">
      <div class="rank">#${row.rank || index + 1}</div>

      <div>
        <div class="player">${row.player || "Unknown Player"}</div>
        <div class="meta">${row.team || ""} • ${row.game || ""}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Score</div>
        <div class="stat-value">${row.score ?? "--"}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Odds</div>
        <div class="stat-value">${row.odds || "--"}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Edge</div>
        <div class="stat-value">${row.edge || "--"}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Note</div>
        <div class="stat-value">${row.note || "--"}</div>
      </div>
    </article>
  `).join("");
}

document.querySelectorAll("nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    state.sport = btn.dataset.sport;
    render();
  });
});

document.querySelectorAll(".tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    state.market = btn.dataset.market;
    render();
  });
});

render();
