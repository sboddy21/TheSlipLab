const DATA_ROOT = "./data";

async function loadJSON(file) {
  try {
    const response = await fetch(`${DATA_ROOT}/${file}?t=${Date.now()}`);
    if (!response.ok) throw new Error(file);
    return await response.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

function color(score) {
  if (score >= 90) return "#ff3b30";
  if (score >= 75) return "#ff6b00";
  if (score >= 60) return "#ffd60a";
  if (score >= 45) return "#64d2ff";
  return "#30d158";
}

function clean(value) {
  if (value === null || value === undefined || value === "") return "-";
  return value;
}

function card(team) {
  const c = color(Number(team.dangerScore || 0));

  return `
    <article class="card" style="border-color:${c}">
      <div class="top">
        <h2>${team.team}</h2>
        <span style="color:${c}">${team.grade}</span>
      </div>

      <div class="score" style="color:${c}">${team.dangerScore}</div>

      <div class="grid">
        <div><label>Fatigue</label><strong>${clean(team.fatigueScore)}</strong></div>
        <div><label>HR Risk</label><strong>${clean(team.hrRiskScore)}</strong></div>
        <div><label>Collapse</label><strong>${clean(team.collapseScore)}</strong></div>
        <div><label>Weather</label><strong>${clean(team.weatherBoost)}</strong></div>
        <div><label>Park Factor</label><strong>${clean(team.parkFactor)}</strong></div>
        <div><label>Source</label><strong>${clean(team.source)}</strong></div>
      </div>
    </article>
  `;
}

async function boot() {
  const rows = await loadJSON("bullpen_collapse_engine.json");
  const app = document.getElementById("board");

  app.innerHTML = Array.isArray(rows) && rows.length
    ? rows.map(card).join("")
    : `<div class="empty">No bullpen collapse data found.</div>`;
}

document.body.innerHTML = `
  <header>
    <div class="brand">THE SLIP LAB</div>
    <nav>
      <a href="./">Home</a>
      <a href="./command-center.html">Command Center</a>
      <a href="./live-game-center.html">Live Games</a>
      <a href="./live-heatmap.html">Heatmap</a>
      <a href="./player-intelligence.html">Players</a>
    </nav>
  </header>

  <main>
    <section class="hero">
      <h1>Bullpen Collapse Engine</h1>
      <p>Team bullpen danger, collapse pressure, HR risk, park pressure, and late inning volatility.</p>
    </section>

    <section id="board" class="grid"></section>
  </main>
`;

const style = document.createElement("style");

style.innerHTML = `
  * { box-sizing:border-box; }

  body {
    margin:0;
    background:#040404;
    color:white;
    font-family:Inter,Arial,sans-serif;
  }

  header {
    display:flex;
    justify-content:space-between;
    align-items:center;
    padding:20px 28px;
    border-bottom:1px solid #1f1f1f;
    background:#040404;
    position:sticky;
    top:0;
    z-index:999;
  }

  .brand {
    font-size:24px;
    font-weight:900;
  }

  nav {
    display:flex;
    gap:10px;
    flex-wrap:wrap;
  }

  nav a {
    color:white;
    text-decoration:none;
    background:#111;
    border:1px solid #242424;
    padding:10px 13px;
    border-radius:999px;
    font-size:12px;
    font-weight:800;
  }

  nav a:hover {
    color:#30d158;
    border-color:#30d158;
  }

  main {
    padding:28px;
  }

  .hero h1 {
    margin:0 0 10px;
    font-size:34px;
  }

  .hero p {
    color:#aaa;
    max-width:760px;
    line-height:1.5;
  }

  .grid {
    display:grid;
    grid-template-columns:repeat(auto-fill,minmax(340px,1fr));
    gap:20px;
    margin-top:26px;
  }

  .card {
    background:#0d0d0d;
    border:2px solid #222;
    border-radius:22px;
    padding:20px;
  }

  .top {
    display:flex;
    justify-content:space-between;
    gap:14px;
    align-items:flex-start;
  }

  h2 {
    margin:0;
    font-size:20px;
  }

  .top span {
    font-size:12px;
    font-weight:900;
  }

  .score {
    font-size:44px;
    font-weight:900;
    margin:18px 0;
  }

  .grid .grid {
    margin-top:0;
  }

  .card .grid {
    display:grid;
    grid-template-columns:repeat(2,1fr);
    gap:10px;
  }

  .card .grid div {
    background:#111;
    border:1px solid #202020;
    border-radius:14px;
    padding:12px;
  }

  label {
    display:block;
    color:#8e8e93;
    font-size:10px;
    margin-bottom:6px;
    letter-spacing:1px;
    text-transform:uppercase;
  }

  strong {
    font-size:14px;
    overflow-wrap:anywhere;
  }

  .empty {
    color:#aaa;
    background:#0d0d0d;
    border:1px solid #242424;
    border-radius:18px;
    padding:20px;
  }

  @media(max-width:768px) {
    header {
      flex-direction:column;
      align-items:flex-start;
      gap:14px;
      padding:16px 14px;
    }

    main {
      padding:18px 14px;
    }

    .hero h1 {
      font-size:28px;
    }

    .grid {
      grid-template-columns:1fr;
    }
  }
`;

document.head.appendChild(style);
boot();
