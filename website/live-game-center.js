const DATA_ROOT = "./data";

async function loadJSON(file) {
  try {
    const response = await fetch(
      `${DATA_ROOT}/${file}?t=${Date.now()}`
    );

    if (!response.ok) {
      throw new Error(file);
    }

    return await response.json();
  } catch (err) {
    console.error(err);
    return {};
  }
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function color(score) {
  if (score >= 85) return "#ff3b30";
  if (score >= 70) return "#ff9f0a";
  if (score >= 55) return "#ffd60a";
  return "#30d158";
}

function label(score) {
  if (score >= 85) return "EXPLOSION";
  if (score >= 70) return "VOLATILE";
  if (score >= 55) return "ACTIVE";
  return "STABLE";
}

function meter(value, colorValue) {
  return `
    <div class="meter-wrap">
      <div
        class="meter-fill"
        style="
          width:${value}%;
          background:${colorValue};
        "
      ></div>
    </div>
  `;
}

function gameCard(game) {
  const leverageColor =
    color(game.leverageScore);

  const hrColor =
    color(game.hrEnvironmentScore);

  return `
    <article
      class="game-card"
      style="
        border-color:${leverageColor};
      "
    >

      <div class="game-top">
        <div>
          <h2>${game.game}</h2>

          <div class="alert">
            ${game.liveAlert}
          </div>
        </div>

        <div
          class="volatility"
          style="
            color:${leverageColor};
          "
        >
          ${label(game.leverageScore)}
        </div>
      </div>

      <div class="section">

        <div class="metric-row">
          <div class="metric-label">
            LEVERAGE
          </div>

          <div class="metric-score">
            ${game.leverageScore}
          </div>
        </div>

        ${meter(
          game.leverageScore,
          leverageColor
        )}

      </div>

      <div class="section">

        <div class="metric-row">
          <div class="metric-label">
            HR ENVIRONMENT
          </div>

          <div class="metric-score">
            ${game.hrEnvironmentScore}
          </div>
        </div>

        ${meter(
          game.hrEnvironmentScore,
          hrColor
        )}

      </div>

      <div class="grid">

        <div class="stat-box">
          <label>HOME BULLPEN</label>
          <strong>
            ${game.homeBullpenGrade}
          </strong>
        </div>

        <div class="stat-box">
          <label>AWAY BULLPEN</label>
          <strong>
            ${game.awayBullpenGrade}
          </strong>
        </div>

        <div class="stat-box">
          <label>HOME PRESSURE</label>
          <strong>
            ${game.homePressureScore}
          </strong>
        </div>

        <div class="stat-box">
          <label>AWAY PRESSURE</label>
          <strong>
            ${game.awayPressureScore}
          </strong>
        </div>

        <div class="stat-box">
          <label>CHAIN RISK</label>
          <strong>
            ${game.chainReactionRisk}
          </strong>
        </div>

        <div class="stat-box">
          <label>WEATHER BOOST</label>
          <strong>
            ${game.weatherBoost}
          </strong>
        </div>

      </div>

      <div class="late-env">

        <div>
          <span>HOME:</span>
          ${game.homeLateEnvironment}
        </div>

        <div>
          <span>AWAY:</span>
          ${game.awayLateEnvironment}
        </div>

      </div>

    </article>
  `;
}

async function boot() {
  const payload =
    await loadJSON(
      "live_game_state.json"
    );

  const games =
    payload.games || [];

  const app =
    document.getElementById(
      "live-game-center"
    );

  if (!app) return;

  app.innerHTML =
    games.map(gameCard).join("");
}

document.body.innerHTML = `
  <div class="shell">

    <header class="topbar">

      <div class="brand">
        THE SLIP LAB
      </div>

      <div class="sub">
        LIVE GAME CENTER
      </div>

    </header>

    <main>

      <section class="hero">

        <h1>
          Live Leverage Intelligence
        </h1>

        <p>
          Real time volatility,
          bullpen collapse,
          HR environments,
          chain reaction risk,
          and leverage pressure.
        </p>

      </section>

      <section
        id="live-game-center"
        class="game-grid"
      ></section>

    </main>

  </div>
`;

const style =
  document.createElement("style");

style.innerHTML = `
  * {
    box-sizing:border-box;
  }

  body {
    margin:0;
    background:#050505;
    color:white;
    font-family:Inter,sans-serif;
  }

  .shell {
    padding-bottom:60px;
  }

  .topbar {
    display:flex;
    justify-content:space-between;
    align-items:center;
    padding:20px 28px;
    border-bottom:1px solid #1f1f1f;
    position:sticky;
    top:0;
    background:#050505;
    z-index:999;
  }

  .brand {
    font-size:24px;
    font-weight:800;
    letter-spacing:1px;
  }

  .sub {
    color:#8e8e93;
    font-size:14px;
    text-transform:uppercase;
  }

  .hero {
    padding:28px;
  }

  .hero h1 {
    margin:0 0 10px;
    font-size:34px;
  }

  .hero p {
    margin:0;
    color:#9f9f9f;
    max-width:700px;
    line-height:1.5;
  }

  .game-grid {
    display:grid;
    grid-template-columns:
      repeat(
        auto-fill,
        minmax(420px,1fr)
      );

    gap:22px;
    padding:0 28px;
  }

  .game-card {
    background:#0d0d0d;
    border:2px solid #222;
    border-radius:22px;
    padding:22px;
  }

  .game-top {
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
    margin-bottom:18px;
  }

  .game-top h2 {
    margin:0 0 8px;
    font-size:22px;
  }

  .alert {
    color:#ff9f0a;
    font-weight:700;
    font-size:13px;
    letter-spacing:.5px;
  }

  .volatility {
    font-size:13px;
    font-weight:800;
    letter-spacing:1px;
  }

  .section {
    margin-bottom:20px;
  }

  .metric-row {
    display:flex;
    justify-content:space-between;
    align-items:center;
    margin-bottom:8px;
  }

  .metric-label {
    font-size:12px;
    letter-spacing:1px;
    color:#8e8e93;
  }

  .metric-score {
    font-size:18px;
    font-weight:800;
  }

  .meter-wrap {
    width:100%;
    height:12px;
    background:#1a1a1a;
    border-radius:999px;
    overflow:hidden;
  }

  .meter-fill {
    height:100%;
    border-radius:999px;
    transition:.4s ease;
  }

  .grid {
    display:grid;
    grid-template-columns:
      repeat(2,1fr);

    gap:12px;
    margin-top:20px;
  }

  .stat-box {
    background:#111;
    border:1px solid #1f1f1f;
    border-radius:14px;
    padding:12px;
  }

  .stat-box label {
    display:block;
    font-size:10px;
    color:#8e8e93;
    margin-bottom:6px;
    letter-spacing:1px;
  }

  .stat-box strong {
    font-size:15px;
  }

  .late-env {
    margin-top:22px;
    display:flex;
    flex-direction:column;
    gap:10px;
    font-size:13px;
  }

  .late-env span {
    color:#8e8e93;
    margin-right:6px;
  }

  @media (max-width:768px) {

    .game-grid {
      grid-template-columns:1fr;
      padding:0 14px;
    }

    .hero {
      padding:18px 14px;
    }

    .hero h1 {
      font-size:28px;
    }

    .topbar {
      padding:16px 14px;
    }

  }
`;

document.head.appendChild(style);

boot();

setInterval(() => {
  boot();
}, 60000);
