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

function color(score) {
  if (score >= 90) return "#ff3b30";
  if (score >= 75) return "#ff6b00";
  if (score >= 60) return "#ffd60a";
  return "#30d158";
}

function glow(score) {
  if (score >= 90) {
    return `
      0 0 12px rgba(255,59,48,.8),
      0 0 28px rgba(255,59,48,.6)
    `;
  }

  if (score >= 75) {
    return `
      0 0 10px rgba(255,107,0,.7),
      0 0 24px rgba(255,107,0,.5)
    `;
  }

  if (score >= 60) {
    return `
      0 0 8px rgba(255,214,10,.6),
      0 0 18px rgba(255,214,10,.4)
    `;
  }

  return `
    0 0 6px rgba(48,209,88,.4)
  `;
}

function pulseClass(score) {
  if (score >= 90) return "pulse-red";
  if (score >= 75) return "pulse-orange";
  if (score >= 60) return "pulse-yellow";
  return "";
}

function label(score) {
  if (score >= 90) return "EXPLOSION";
  if (score >= 75) return "CHAIN ACTIVE";
  if (score >= 60) return "VOLATILE";
  return "STABLE";
}

function gameCard(game) {
  const score =
    Number(game.chainReactionScore || 0);

  const cardColor = color(score);

  return `
    <article
      class="
        heat-card
        ${pulseClass(score)}
      "
      style="
        border-color:${cardColor};
        box-shadow:${glow(score)};
      "
    >

      <div class="heat-top">

        <div>

          <h2>${game.game}</h2>

          <div
            class="status"
            style="
              color:${cardColor};
            "
          >
            ${label(score)}
          </div>

        </div>

        <div
          class="score"
          style="
            color:${cardColor};
          "
        >
          ${score}
        </div>

      </div>

      <div class="bar-wrap">
        <div
          class="bar-fill"
          style="
            width:${score}%;
            background:${cardColor};
          "
        ></div>
      </div>

      <div class="grid">

        <div class="box">
          <label>CHAIN</label>
          <strong>
            ${game.chainReactionScore}
          </strong>
        </div>

        <div class="box">
          <label>EXPLOSION</label>
          <strong>
            ${game.inningExplosionRisk}
          </strong>
        </div>

        <div class="box">
          <label>RAPID FIRE</label>
          <strong>
            ${game.rapidFireHrProbability}
          </strong>
        </div>

        <div class="box">
          <label>TILT</label>
          <strong>
            ${game.pitcherTiltFactor}
          </strong>
        </div>

        <div class="box">
          <label>BULLPEN</label>
          <strong>
            ${game.bullpenStressMultiplier}
          </strong>
        </div>

        <div class="box">
          <label>MOMENTUM</label>
          <strong>
            ${game.crowdMomentumRating}
          </strong>
        </div>

      </div>

      <div class="alert">
        ${game.liveAlert}
      </div>

    </article>
  `;
}

async function boot() {
  const payload =
    await loadJSON(
      "hr_chain_reaction.json"
    );

  const games =
    payload.games || [];

  const app =
    document.getElementById(
      "heatmap-board"
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
        LIVE HEATMAP
      </div>

    </header>

    <main>

      <section class="hero">

        <h1>
          Live Volatility Heatmap
        </h1>

        <p>
          Real time HR pressure,
          chain reaction risk,
          leverage escalation,
          and inning explosion tracking.
        </p>

      </section>

      <section
        id="heatmap-board"
        class="grid-board"
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
    background:#040404;
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
    background:#040404;
    z-index:999;
  }

  .brand {
    font-size:24px;
    font-weight:800;
  }

  .sub {
    color:#8e8e93;
    font-size:13px;
    letter-spacing:1px;
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

  .grid-board {
    display:grid;
    grid-template-columns:
      repeat(
        auto-fill,
        minmax(420px,1fr)
      );

    gap:24px;
    padding:0 28px;
  }

  .heat-card {
    background:#0d0d0d;
    border:2px solid #222;
    border-radius:22px;
    padding:22px;
    transition:.4s ease;
  }

  .heat-top {
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
    margin-bottom:18px;
  }

  .heat-top h2 {
    margin:0 0 8px;
    font-size:22px;
  }

  .status {
    font-size:12px;
    font-weight:800;
    letter-spacing:1px;
  }

  .score {
    font-size:40px;
    font-weight:900;
  }

  .bar-wrap {
    width:100%;
    height:14px;
    background:#1a1a1a;
    border-radius:999px;
    overflow:hidden;
    margin-bottom:20px;
  }

  .bar-fill {
    height:100%;
    border-radius:999px;
  }

  .grid {
    display:grid;
    grid-template-columns:
      repeat(2,1fr);

    gap:12px;
  }

  .box {
    background:#111;
    border:1px solid #1f1f1f;
    border-radius:14px;
    padding:12px;
  }

  .box label {
    display:block;
    font-size:10px;
    color:#8e8e93;
    margin-bottom:6px;
    letter-spacing:1px;
  }

  .box strong {
    font-size:15px;
  }

  .alert {
    margin-top:20px;
    font-size:13px;
    font-weight:700;
    color:#ff9f0a;
    letter-spacing:1px;
  }

  .pulse-red {
    animation:redPulse 1.5s infinite;
  }

  .pulse-orange {
    animation:orangePulse 2s infinite;
  }

  .pulse-yellow {
    animation:yellowPulse 2.5s infinite;
  }

  @keyframes redPulse {
    0% {
      transform:scale(1);
    }

    50% {
      transform:scale(1.015);
    }

    100% {
      transform:scale(1);
    }
  }

  @keyframes orangePulse {
    0% {
      transform:scale(1);
    }

    50% {
      transform:scale(1.01);
    }

    100% {
      transform:scale(1);
    }
  }

  @keyframes yellowPulse {
    0% {
      transform:scale(1);
    }

    50% {
      transform:scale(1.005);
    }

    100% {
      transform:scale(1);
    }
  }

  @media (max-width:768px) {

    .grid-board {
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
