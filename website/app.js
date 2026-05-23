const state = {
  stackIntel: [],
  leverage: [],
  collapse: []
};

async function loadJson(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Failed loading ${path}`);
  }

  return response.json();
}

function clean(value) {
  return value ?? "";
}

function gradeClass(grade = "") {
  const g = grade.toLowerCase();

  if (g.includes("nuke")) return "grade-nuke";
  if (g.includes("elite")) return "grade-elite";
  if (g.includes("attack")) return "grade-attack";
  if (g.includes("live")) return "grade-live";

  return "grade-watch";
}

function volatilityClass(label = "") {
  const v = label.toLowerCase();

  if (v.includes("nuclear")) return "vol-nuclear";
  if (v.includes("chaotic")) return "vol-chaotic";
  if (v.includes("aggressive")) return "vol-aggressive";
  if (v.includes("stable")) return "vol-stable";

  return "vol-safe";
}

function renderNav() {
  return `
    <nav class="top-nav">
      <button class="nav-btn active" data-page="stacklab">
        Stack Lab
      </button>

      <button class="nav-btn" data-page="collapse">
        Collapse Alerts
      </button>

      <button class="nav-btn" data-page="leverage">
        Leverage
      </button>
    </nav>
  `;
}

function renderHeader() {
  return `
    <header class="hero">
      <div>
        <h1>THE SLIP LAB</h1>
        <p>
          Team Stack Intelligence 2.0
        </p>
      </div>

      <div class="live-pill">
        LIVE
      </div>
    </header>
  `;
}

function stackCard(stack) {
  return `
    <article class="stack-card ${gradeClass(stack.stackGrade)}">

      <div class="stack-top">
        <div>
          <div class="stack-team">
            ${clean(stack.team)}
          </div>

          <div class="stack-game">
            vs ${clean(stack.opponent)}
          </div>
        </div>

        <div class="stack-grade">
          ${clean(stack.stackGrade)}
        </div>
      </div>

      <div class="stack-players">
        ${clean(stack.players)}
      </div>

      <div class="stack-grid">

        <div class="metric">
          <span>SIZE</span>
          <strong>${clean(stack.stackSize)} MAN</strong>
        </div>

        <div class="metric">
          <span>SCORE</span>
          <strong>${clean(stack.finalStackScore)}</strong>
        </div>

        <div class="metric">
          <span>CHAIN</span>
          <strong>${clean(stack.hrChainReactionProbability)}</strong>
        </div>

        <div class="metric">
          <span>LEVERAGE</span>
          <strong>${clean(stack.leverageScore)}</strong>
        </div>

      </div>

      <div class="volatility ${volatilityClass(stack.volatilityMeter)}">
        ${clean(stack.volatilityMeter)}
      </div>

      <div class="stack-footer">

        <div>
          <span>Pitcher Collapse</span>
          <strong>${clean(stack.pitcherCollapseProbability)}</strong>
        </div>

        <div>
          <span>Bullpen Collapse</span>
          <strong>${clean(stack.bullpenCollapseScore)}</strong>
        </div>

      </div>

      <div class="lane">
        ${clean(stack.correlatedHrLane)}
      </div>

    </article>
  `;
}

function collapseCard(alert) {
  return `
    <article class="collapse-card">

      <div class="collapse-top">
        <div>
          <h3>${clean(alert.opposingPitcher)}</h3>
          <p>${clean(alert.team)} offense</p>
        </div>

        <div class="collapse-label">
          ${clean(alert.collapseLabel)}
        </div>
      </div>

      <div class="collapse-grid">

        <div>
          <span>Pitcher</span>
          <strong>${clean(alert.pitcherCollapseProbability)}</strong>
        </div>

        <div>
          <span>Bullpen</span>
          <strong>${clean(alert.bullpenCollapseScore)}</strong>
        </div>

        <div>
          <span>Weather</span>
          <strong>${clean(alert.weatherBoost)}</strong>
        </div>

      </div>

    </article>
  `;
}

function leverageCard(stack) {
  return `
    <article class="leverage-card">

      <div class="lev-top">

        <div>
          <h3>${clean(stack.team)}</h3>
          <p>${clean(stack.players)}</p>
        </div>

        <div class="lev-grade">
          ${clean(stack.leverageProfile)}
        </div>

      </div>

      <div class="lev-score">
        ${clean(stack.leverageScore)}
      </div>

      <div class="lev-reason">
        ${clean(stack.reason)}
      </div>

    </article>
  `;
}

function renderStackLab() {
  return `
    <section class="page active" id="stacklab">

      <div class="section-title">
        TOP STACKS
      </div>

      <div class="stack-board">
        ${state.stackIntel
          .slice(0, 24)
          .map(stackCard)
          .join("")}
      </div>

    </section>
  `;
}

function renderCollapse() {
  return `
    <section class="page" id="collapse">

      <div class="section-title">
        COLLAPSE ALERTS
      </div>

      <div class="collapse-board">
        ${state.collapse
          .slice(0, 20)
          .map(collapseCard)
          .join("")}
      </div>

    </section>
  `;
}

function renderLeverage() {
  return `
    <section class="page" id="leverage">

      <div class="section-title">
        LEVERAGE STACKS
      </div>

      <div class="leverage-board">
        ${state.leverage
          .slice(0, 20)
          .map(leverageCard)
          .join("")}
      </div>

    </section>
  `;
}

function renderApp() {
  document.body.innerHTML = `
    <main class="app-shell">

      ${renderHeader()}

      ${renderNav()}

      ${renderStackLab()}

      ${renderCollapse()}

      ${renderLeverage()}

    </main>
  `;

  attachNavEvents();
}

function attachNavEvents() {
  const buttons = document.querySelectorAll(".nav-btn");
  const pages = document.querySelectorAll(".page");

  buttons.forEach(button => {
    button.addEventListener("click", () => {
      const target = button.dataset.page;

      buttons.forEach(b =>
        b.classList.remove("active")
      );

      pages.forEach(p =>
        p.classList.remove("active")
      );

      button.classList.add("active");

      document
        .getElementById(target)
        .classList.add("active");
    });
  });
}

async function boot() {
  try {
    const [
      stackData,
      leverageData,
      collapseData
    ] = await Promise.all([
      loadJson("./data/team_stack_intelligence_2.json"),
      loadJson("./data/stack_leverage_profiles.json"),
      loadJson("./data/collapse_alerts.json")
    ]);

    state.stackIntel = stackData.stacks || [];
    state.leverage = leverageData.profiles || [];
    state.collapse = collapseData.alerts || [];

    renderApp();

  } catch (err) {
    console.error(err);

    document.body.innerHTML = `
      <div class="error-screen">
        Failed loading Stack Intelligence 2.0
      </div>
    `;
  }
}

boot();

setInterval(() => {
  boot();
}, 1000 * 60 * 5);
