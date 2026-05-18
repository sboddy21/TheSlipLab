const state = {
  sport: "mlb",
  market: "home_runs"
};

const sampleData = {
  mlb: {
    home_runs: [
      { player: "Aaron Judge", team: "NYY", game: "NYY at TEX", score: 91, odds: "+310", edge: "Strong", note: "Power profile plus matchup" },
      { player: "Kyle Schwarber", team: "PHI", game: "CIN at PHI", score: 87, odds: "+360", edge: "Strong", note: "Pull power spot" },
      { player: "Shohei Ohtani", team: "LAD", game: "LAD at SD", score: 84, odds: "+330", edge: "Live", note: "Elite barrel profile" }
    ],
    hits: [
      { player: "Luis Arraez", team: "SD", game: "LAD at SD", score: 93, odds: "-220", edge: "Safe", note: "Contact profile" },
      { player: "Bobby Witt Jr.", team: "KC", game: "BOS at KC", score: 89, odds: "-175", edge: "Safe", note: "Speed plus contact" }
    ],
    total_bases: [
      { player: "Juan Soto", team: "NYM", game: "NYM at WAS", score: 88, odds: "+115", edge: "Value", note: "OBP and power lane" },
      { player: "Pete Alonso", team: "BAL", game: "BAL at TB", score: 85, odds: "+135", edge: "Value", note: "Extra base upside" }
    ],
    rbis: [
      { player: "Rafael Devers", team: "SF", game: "SF at ARI", score: 82, odds: "+150", edge: "Live", note: "Run production spot" }
    ]
  },
  nba: {},
  nhl: {},
  nfl: {}
};

function titleCase(text) {
  return text.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
}

function render() {
  document.querySelectorAll("nav button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.sport === state.sport);
  });

  document.querySelectorAll(".tabs button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.market === state.market);
  });

  document.getElementById("page-title").textContent = `${state.sport.toUpperCase()} Lab`;

  const subtitle = state.sport === "mlb"
    ? "Home Runs, Hits, Total Bases, and RBIs."
    : "Coming soon.";

  document.getElementById("page-subtitle").textContent = subtitle;

  const board = document.getElementById("board");
  const rows = sampleData[state.sport]?.[state.market] || [];

  if (!rows.length) {
    board.innerHTML = `<div class="empty">${state.sport.toUpperCase()} ${titleCase(state.market)} data coming soon.</div>`;
    return;
  }

  board.innerHTML = rows.map((row, index) => `
    <article class="card">
      <div class="rank">#${index + 1}</div>

      <div>
        <div class="player">${row.player}</div>
        <div class="meta">${row.team} • ${row.game}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Score</div>
        <div class="stat-value">${row.score}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Odds</div>
        <div class="stat-value">${row.odds}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Edge</div>
        <div class="stat-value">${row.edge}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Note</div>
        <div class="stat-value">${row.note}</div>
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
