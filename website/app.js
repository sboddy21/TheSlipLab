const DATA_ROOT = "./data";

const state = {
  bullpenCollapse: [],
  collapseAlerts: [],
  stackIntel: []
};

async function loadJSON(file) {
  try {
    const response = await fetch(`${DATA_ROOT}/${file}?t=${Date.now()}`);

    if (!response.ok) {
      throw new Error(`Failed: ${file}`);
    }

    return await response.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

function clean(value) {
  if (value === undefined || value === null) return "-";
  return value;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function dangerColor(score) {
  if (score >= 90) return "#ff3b30";
  if (score >= 75) return "#ff6b00";
  if (score >= 60) return "#ffd60a";
  if (score >= 40) return "#64d2ff";
  return "#30d158";
}

function card(title, body, border = "#2a2a2a") {
  return `
    <article class="sl-card" style="border-color:${border}">
      ${title}
      ${body}
    </article>
  `;
}

function renderBullpenCollapse() {
  const board = document.getElementById("bullpen-board");

  if (!board) return;

  const rows =
    Array.isArray(state.bullpenCollapse)
      ? state.bullpenCollapse
      : [];

  board.innerHTML = rows.map(team => {
    const color = dangerColor(team.dangerScore);

    return card(
      `
      <div class="sl-card-top">
        <strong>${clean(team.team)}</strong>
        <span style="color:${color}">
          ${clean(team.grade)}
        </span>
      </div>
      `,
      `
      <div class="danger-score" style="color:${color}">
        ${clean(team.dangerScore)}
      </div>

      <div class="sl-grid">
        <div>
          <label>Fatigue</label>
          <strong>${clean(team.fatigueScore)}</strong>
        </div>

        <div>
          <label>HR Risk</label>
          <strong>${clean(team.hrRiskScore)}</strong>
        </div>

        <div>
          <label>Collapse</label>
          <strong>${clean(team.collapseScore)}</strong>
        </div>

        <div>
          <label>ERA</label>
          <strong>${clean(team.bullpenEra)}</strong>
        </div>

        <div>
          <label>HR/9</label>
          <strong>${clean(team.bullpenHr9)}</strong>
        </div>

        <div>
          <label>B2B Arms</label>
          <strong>${clean(team.backToBackArms)}</strong>
        </div>
      </div>
      `,
      color
    );
  }).join("");
}

function renderCollapseAlerts() {
  const board = document.getElementById("collapse-alert-board");

  if (!board) return;

  const payload = state.collapseAlerts || {};
  const alerts = payload.alerts || payload;

  board.innerHTML = alerts.map(alert => {
    const color = dangerColor(alert.bullpenDangerScore);

    return card(
      `
      <div class="sl-card-top">
        <strong>${clean(alert.team)}</strong>
        <span style="color:${color}">
          ${clean(alert.enhancedGrade)}
        </span>
      </div>
      `,
      `
      <div class="alert-environment">
        ${clean(alert.lateGameEnvironment)}
      </div>

      <div class="sl-grid">
        <div>
          <label>Stack Score</label>
          <strong>${clean(alert.enhancedStackScore)}</strong>
        </div>

        <div>
          <label>Collapse Boost</label>
          <strong>${clean(alert.collapseBoost)}</strong>
        </div>

        <div>
          <label>Bullpen Grade</label>
          <strong>${clean(alert.bullpenGrade)}</strong>
        </div>

        <div>
          <label>Opponent</label>
          <strong>${clean(alert.opponent)}</strong>
        </div>
      </div>
      `,
      color
    );
  }).join("");
}

function renderTopStacks() {
  const board = document.getElementById("stack-intel-board");

  if (!board) return;

  const payload = state.stackIntel || {};
  const stacks = payload.stacks || payload;

  board.innerHTML = stacks
    .slice(0, 15)
    .map(stack => {
      const color = dangerColor(stack.bullpenDangerScore);

      return card(
        `
        <div class="sl-card-top">
          <strong>${clean(stack.team)}</strong>
          <span style="color:${color}">
            ${clean(stack.enhancedGrade)}
          </span>
        </div>
        `,
        `
        <div class="danger-score" style="color:${color}">
          ${clean(stack.enhancedStackScore)}
        </div>

        <div class="sl-grid">
          <div>
            <label>Opponent</label>
            <strong>${clean(stack.opponent)}</strong>
          </div>

          <div>
            <label>Bullpen</label>
            <strong>${clean(stack.bullpenGrade)}</strong>
          </div>

          <div>
            <label>Collapse</label>
            <strong>${clean(stack.bullpenCollapseScore)}</strong>
          </div>

          <div>
            <label>Late Env</label>
            <strong>${clean(stack.lateGameEnvironment)}</strong>
          </div>
        </div>
        `,
        color
      );
    })
    .join("");
}

async function boot() {
  state.bullpenCollapse =
    await loadJSON("bullpen_collapse_engine.json");

  state.collapseAlerts =
    await loadJSON("collapse_alerts.json");

  state.stackIntel =
    await loadJSON("team_stack_intelligence_2.json");

  renderBullpenCollapse();
  renderCollapseAlerts();
  renderTopStacks();
}

document.body.innerHTML = `
  <div class="app-shell">

    <header class="topbar">
      <div class="logo">
        THE SLIP LAB
      </div>

      <nav class="nav">
        <button>Home</button>
        <button>HR Model</button>
        <button>Stacks</button>
        <button class="active">
          Bullpen Collapse
        </button>
      </nav>
    </header>

    <main class="content">

      <section>
        <h1>Bullpen Collapse Engine</h1>
        <div id="bullpen-board" class="card-grid"></div>
      </section>

      <section>
        <h1>Late Inning Explosion Alerts</h1>
        <div id="collapse-alert-board" class="card-grid"></div>
      </section>

      <section>
        <h1>Top Stack Environments</h1>
        <div id="stack-intel-board" class="card-grid"></div>
      </section>

    </main>
  </div>
`;

const style = document.createElement("style");

style.innerHTML = `
  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: #050505;
    color: white;
    font-family: Inter, sans-serif;
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 28px;
    border-bottom: 1px solid #1f1f1f;
    position: sticky;
    top: 0;
    background: #050505;
    z-index: 1000;
  }

  .logo {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 1px;
  }

  .nav {
    display: flex;
    gap: 12px;
  }

  .nav button {
    background: #101010;
    border: 1px solid #252525;
    color: white;
    padding: 10px 14px;
    border-radius: 10px;
    cursor: pointer;
  }

  .nav .active {
    border-color: #30d158;
    color: #30d158;
  }

  .content {
    padding: 24px;
  }

  h1 {
    margin-bottom: 20px;
    font-size: 24px;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 18px;
    margin-bottom: 42px;
  }

  .sl-card {
    background: #0d0d0d;
    border: 2px solid #202020;
    border-radius: 18px;
    padding: 18px;
  }

  .sl-card-top {
    display: flex;
    justify-content: space-between;
    margin-bottom: 14px;
    font-size: 16px;
  }

  .danger-score {
    font-size: 42px;
    font-weight: 800;
    margin-bottom: 16px;
  }

  .sl-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .sl-grid label {
    display: block;
    font-size: 11px;
    color: #8e8e93;
    margin-bottom: 4px;
    text-transform: uppercase;
  }

  .sl-grid strong {
    font-size: 15px;
  }

  .alert-environment {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 14px;
    color: #ff9f0a;
  }

  @media (max-width: 768px) {
    .topbar {
      flex-direction: column;
      gap: 12px;
      align-items: flex-start;
    }

    .nav {
      flex-wrap: wrap;
    }

    .content {
      padding: 14px;
    }

    .card-grid {
      grid-template-columns: 1fr;
    }
  }
`;

document.head.appendChild(style);

boot();

setInterval(() => {
  boot();
}, 300000);
