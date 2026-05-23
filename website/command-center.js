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

function pulse(score) {
  if (score >= 90) return "pulse-red";
  if (score >= 75) return "pulse-orange";
  if (score >= 60) return "pulse-yellow";
  return "";
}

function metric(label, value) {
  return `
    <div class="metric-box">
      <label>${label}</label>
      <strong>${value}</strong>
    </div>
  `;
}

function timeline(events = []) {
  return `
    <div class="timeline">
      ${events.map(event => `
        <div class="timeline-event">

          <div class="inning">
            ${event.inning}
          </div>

          <div class="event-body">

            <div class="event-type">
              ${event.eventType}
            </div>

            <div class="event-label">
              ${event.impactLabel}
            </div>

          </div>

          <div class="impact">
            ${event.impactScore}
          </div>

        </div>
      `).join("")}
    </div>
  `;
}

function card(game, tracker) {
  const score =
    Number(game.chainReactionScore || 0);

  const c = color(score);

  return `
    <article
      class="
        cc-card
        ${pulse(score)}
      "
      style="
        border-color:${c};
      "
    >

      <div class="cc-top">

        <div>

          <h2>${game.game}</h2>

          <div
            class="alert"
            style="
              color:${c};
            "
          >
            ${game.liveAlert}
          </div>

        </div>

        <div
          class="score"
          style="
            color:${c};
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
            background:${c};
          "
        ></div>
      </div>

      <div class="metric-grid">

        ${metric(
          "LEVERAGE",
          game.leverageScore
        )}

        ${metric(
          "HR ENV",
          game.hrEnvironmentScore
        )}

        ${metric(
          "CHAIN",
          game.chainReactionScore
        )}

        ${metric(
          "EXPLOSION",
          game.inningExplosionRisk
        )}

        ${metric(
          "RAPID FIRE",
          game.rapidFireHrProbability
        )}

        ${metric(
          "TILT",
          game.pitcherTiltFactor
        )}

      </div>

      <div class="section-title">
        LIVE TIMELINE
      </div>

      ${timeline(
        tracker.timeline || []
      )}

    </article>
  `;
}

async function boot() {
  const chainPayload =
    await loadJSON(
      "hr_chain_reaction.json"
    );

  const trackerPayload =
    await loadJSON(
      "live_hr_tracker.json"
    );

  const games =
    chainPayload.games || [];

  const trackers =
    trackerPayload.games || [];

  const trackerMap = {};

  for (const row of trackers) {
    trackerMap[row.game] = row;
  }

  const app =
    document.getElementById(
      "command-center"
    );

  if (!app) return;

  app.innerHTML =
    games.map(game =>
      card(
        game,
        trackerMap[game.game] || {}
      )
    ).join("");
}

document.body.innerHTML = `
  <div class="shell">

    <header class="topbar">

      <div class="brand">
        THE SLIP LAB
      </div>

      <div class="sub">
        COMMAND CENTER
      </div>

    </header>

    <main>

      <section class="hero">

        <h1>
          Live Baseball Intelligence
        </h1>

        <p>
          Real time leverage,
          volatility,
          bullpen collapse,
          HR chain reactions,
          inning timelines,
          and live momentum tracking.
        </p>

      </section>

      <section
        id="command-center"
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
    max-width:760px;
    line-height:1.5;
  }

  .grid-board {
    display:grid;
    grid-template-columns:
      repeat(
        auto-fill,
        minmax(500px,1fr)
      );

    gap:24px;
    padding:0 28px;
  }

  .cc-card {
    background:#0d0d0d;
    border:2px solid #222;
    border-radius:24px;
    padding:24px;
  }

  .cc-top {
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
    margin-bottom:18px;
  }

  .cc-top h2 {
    margin:0 0 8px;
    font-size:24px;
  }

  .alert {
    font-size:12px;
    font-weight:800;
    letter-spacing:1px;
  }

  .score {
    font-size:46px;
    font-weight:900;
  }

  .bar-wrap {
    width:100%;
    height:14px;
    background:#1a1a1a;
    border-radius:999px;
    overflow:hidden;
    margin-bottom:24px;
  }

  .bar-fill {
    height:100%;
    border-radius:999px;
  }

  .metric-grid {
    display:grid;
    grid-template-columns:
      repeat(3,1fr);

    gap:12px;

    margin-bottom:24px;
  }

  .metric-box {
    background:#111;
    border:1px solid #1f1f1f;
    border-radius:14px;
    padding:12px;
  }

  .metric-box label {
    display:block;
    font-size:10px;
    color:#8e8e93;
    margin-bottom:6px;
    letter-spacing:1px;
  }

  .metric-box strong {
    font-size:15px;
  }

  .section-title {
    font-size:12px;
    letter-spacing:1px;
    color:#8e8e93;
    margin-bottom:14px;
  }

  .timeline {
    display:flex;
    flex-direction:column;
    gap:12px;
  }

  .timeline-event {
    display:flex;
    align-items:center;
    gap:14px;
    background:#101010;
    border:1px solid #1f1f1f;
    border-radius:14px;
    padding:12px;
  }

  .inning {
    width:36px;
    height:36px;
    border-radius:50%;
    background:#1f1f1f;
    display:flex;
    align-items:center;
    justify-content:center;
    font-weight:800;
  }

  .event-body {
    flex:1;
  }

  .event-type {
    font-size:14px;
    font-weight:700;
  }

  .event-label {
    font-size:11px;
    color:#8e8e93;
    margin-top:4px;
  }

  .impact {
    font-size:18px;
    font-weight:900;
  }

  .pulse-red {
    animation:redPulse 1.4s infinite;
  }

  .pulse-orange {
    animation:orangePulse 2s infinite;
  }

  .pulse-yellow {
    animation:yellowPulse 2.6s infinite;
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

    .metric-grid {
      grid-template-columns:
        repeat(2,1fr);
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
