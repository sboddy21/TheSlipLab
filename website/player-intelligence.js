const DATA_ROOT = "./data";

let allPlayers = [];

async function loadJSON(file) {
  try {
    const response = await fetch(`${DATA_ROOT}/${file}?t=${Date.now()}`);
    if (!response.ok) throw new Error(file);
    return await response.json();
  } catch (err) {
    console.error(err);
    return {};
  }
}

function color(score) {
  if (score >= 90) return "#ff3b30";
  if (score >= 80) return "#ff6b00";
  if (score >= 70) return "#ffd60a";
  if (score >= 60) return "#64d2ff";
  return "#30d158";
}

function card(player) {
  const c = color(Number(player.overallPlayerScore || 0));

  return `
    <article class="player-card" style="border-color:${c}">
      <div class="top">
        <div>
          <h2>${player.player}</h2>
          <p>${player.team || "Unknown Team"} vs ${player.opponent || "Unknown Opponent"}</p>
        </div>
        <div class="score" style="color:${c}">${player.overallPlayerScore}</div>
      </div>

      <div class="grade" style="color:${c}">${player.grade}</div>

      <div class="tags">
        ${(player.profileTags || []).length
          ? (player.profileTags || []).map(tag => `<span>${tag}</span>`).join("")
          : `<span>PROFILE WATCH</span>`
        }
      </div>

      <div class="grid">
        <div><label>Power Form</label><strong>${player.powerFormScore}</strong></div>
        <div><label>Contact Floor</label><strong>${player.contactFloorScore}</strong></div>
        <div><label>Matchup IQ</label><strong>${player.matchupIntelligenceScore}</strong></div>
        <div><label>HR Score</label><strong>${player.hrScore}</strong></div>
        <div><label>Hit Score</label><strong>${player.hitScore}</strong></div>
        <div><label>TB Score</label><strong>${player.tbScore}</strong></div>
        <div><label>Pitch Damage</label><strong>${player.pitchDamageScore}</strong></div>
        <div><label>Zone Score</label><strong>${player.zoneScore}</strong></div>
      </div>

      <div class="matchup">
        <span>Matchup Signal</span>
        <strong>${player.bestPitchMatchup === "PITCHER DAMAGE PROFILE" ? "Pitcher Damage Edge" : player.bestPitchMatchup}</strong>
      </div>
    </article>
  `;
}

function render(players) {
  const app = document.getElementById("players");
  const count = document.getElementById("player-count");

  count.textContent = `${players.length} players`;

  app.innerHTML = players.length
    ? players.map(card).join("")
    : `<div class="empty">No players found.</div>`;
}

function applySearch() {
  const value = document.getElementById("player-search").value.toLowerCase().trim();

  const filtered = allPlayers.filter(player => {
    const haystack = [
      player.player,
      player.team,
      player.opponent,
      player.pitcher,
      player.grade,
      ...(player.profileTags || [])
    ].join(" ").toLowerCase();

    return haystack.includes(value);
  });

  render(filtered);
}

async function boot() {
  const payload = await loadJSON("advanced_player_intelligence.json");

  allPlayers = payload.players || [];

  render(allPlayers);

  document.getElementById("player-search").addEventListener("input", applySearch);
}

document.body.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">THE SLIP LAB</div>
      <nav>
        <a href="./command-center.html">Command Center</a>
        <a href="./live-game-center.html">Live Games</a>
        <a href="./live-heatmap.html">Heatmap</a>
        <a href="./bullpen-collapse.html">Bullpen</a>
      </nav>
    </header>

    <main>
      <section class="hero">
        <h1>Advanced Player Intelligence</h1>
        <p>Search any player and view power form, contact floor, pitch damage, matchup edges, zone scoring, and profile tags.</p>

        <div class="controls">
          <input id="player-search" placeholder="Search player, team, opponent, grade, or tag..." />
          <span id="player-count">0 players</span>
        </div>
      </section>

      <section id="players" class="player-grid"></section>
    </main>
  </div>
`;

const style = document.createElement("style");

style.innerHTML = `
  * { box-sizing:border-box; }

  body {
    margin:0;
    background:#040404;
    color:white;
    font-family:Inter,sans-serif;
  }

  .topbar {
    display:flex;
    justify-content:space-between;
    align-items:center;
    padding:20px 28px;
    border-bottom:1px solid #1f1f1f;
    position:sticky;
    top:0;
    background:#040404;
    z-index:999;
  }

  .brand {
    font-size:24px;
    font-weight:900;
  }

  nav {
    display:flex;
    gap:12px;
    flex-wrap:wrap;
  }

  nav a {
    color:white;
    text-decoration:none;
    background:#111;
    border:1px solid #242424;
    padding:10px 14px;
    border-radius:10px;
    font-size:13px;
  }

  .hero {
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

  .controls {
    margin-top:22px;
    display:flex;
    align-items:center;
    gap:14px;
    flex-wrap:wrap;
  }

  input {
    width:min(520px,100%);
    background:#101010;
    color:white;
    border:1px solid #333;
    border-radius:14px;
    padding:14px 16px;
    font-size:15px;
    outline:none;
  }

  input:focus {
    border-color:#30d158;
  }

  #player-count {
    color:#8e8e93;
    font-size:13px;
  }

  .player-grid {
    display:grid;
    grid-template-columns:repeat(auto-fill,minmax(360px,1fr));
    gap:20px;
    padding:0 28px 60px;
  }

  .player-card {
    background:#0d0d0d;
    border:2px solid #222;
    border-radius:22px;
    padding:20px;
  }

  .top {
    display:flex;
    justify-content:space-between;
    gap:14px;
  }

  h2 {
    margin:0 0 6px;
    font-size:22px;
  }

  p {
    margin:0;
    color:#8e8e93;
  }

  .score {
    font-size:42px;
    font-weight:900;
  }

  .grade {
    font-size:13px;
    font-weight:900;
    margin:14px 0;
    letter-spacing:1px;
  }

  .tags {
    display:flex;
    flex-wrap:wrap;
    gap:8px;
    margin-bottom:18px;
  }

  .tags span {
    border:1px solid #333;
    border-radius:999px;
    padding:6px 10px;
    font-size:11px;
    color:#30d158;
  }

  .grid {
    display:grid;
    grid-template-columns:repeat(2,1fr);
    gap:10px;
  }

  .grid div {
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
    font-size:15px;
  }

  .matchup {
    margin-top:16px;
    padding-top:16px;
    border-top:1px solid #202020;
    display:flex;
    justify-content:space-between;
    gap:12px;
  }

  .matchup span {
    color:#8e8e93;
    font-size:12px;
    text-transform:uppercase;
  }

  .empty {
    color:#8e8e93;
    padding:20px;
    border:1px solid #242424;
    border-radius:18px;
    background:#0d0d0d;
  }

  @media (max-width:768px) {
    .topbar {
      align-items:flex-start;
      flex-direction:column;
      gap:14px;
      padding:16px 14px;
    }

    .hero {
      padding:18px 14px;
    }

    .hero h1 {
      font-size:28px;
    }

    .player-grid {
      grid-template-columns:1fr;
      padding:0 14px 40px;
    }
  }
`;

document.head.appendChild(style);

boot();
