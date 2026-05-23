import fs from "fs";

const file = "website/app.js";
let app = fs.readFileSync(file, "utf8");

function replaceOnce(find, replace) {
  if (!app.includes(find)) {
    throw new Error(`Missing target:\n${find}`);
  }

  app = app.replace(find, replace);
}

replaceOnce(
`  statcastZones: null,
  stacks: null`,
`  statcastZones: null,
  stacks: null,
  stackIntel: null,
  stackLeverage: null,
  collapseAlerts: null`
);

replaceOnce(
`    results: "data/mlb_results.json"`,
`    results: "data/mlb_results.json",
    stack_lab: "data/team_stack_intelligence_2.json"`
);

replaceOnce(
`async function loadTeamStacks() {
  return fetchJson("data/mlb_team_stacks.json", { stacks: [] });
}`,
`async function loadTeamStacks() {
  return fetchJson("data/mlb_team_stacks.json", { stacks: [] });
}

async function loadStackIntelligence2() {
  return fetchJson("data/team_stack_intelligence_2.json", { stacks: [] });
}

async function loadStackLeverageProfiles() {
  return fetchJson("data/stack_leverage_profiles.json", { profiles: [] });
}

async function loadCollapseAlerts() {
  return fetchJson("data/collapse_alerts.json", { alerts: [] });
}`
);

const stackLabFunctions = `
function stackIntelGradeClass(grade = "") {
  const g = String(grade || "").toLowerCase();

  if (g.includes("nuke")) return "grade-nuke";
  if (g.includes("elite")) return "grade-elite";
  if (g.includes("attack")) return "grade-attack";
  if (g.includes("live")) return "grade-live";

  return "grade-watch";
}

function stackIntelVolClass(label = "") {
  const v = String(label || "").toLowerCase();

  if (v.includes("nuclear")) return "vol-nuclear";
  if (v.includes("chaotic")) return "vol-chaotic";
  if (v.includes("aggressive")) return "vol-aggressive";
  if (v.includes("stable")) return "vol-stable";

  return "vol-safe";
}

function renderStackIntelligenceCard(stack) {
  return \`
    <article class="stack-card \${stackIntelGradeClass(stack.stackGrade)}">
      <div class="stack-top">
        <div>
          <div class="stack-team">\${clean(stack.team)}</div>
          <div class="stack-game">vs \${clean(stack.opponent)} • \${clean(stack.stackSize)} Man</div>
        </div>

        <div class="stack-grade">\${clean(stack.stackGrade)}</div>
      </div>

      <div class="stack-players">\${clean(stack.players)}</div>

      <div class="stack-grid">
        <div class="metric"><span>FINAL</span><strong>\${clean(stack.finalStackScore)}</strong></div>
        <div class="metric"><span>CHAIN</span><strong>\${clean(stack.hrChainReactionProbability)}</strong></div>
        <div class="metric"><span>LEVERAGE</span><strong>\${clean(stack.leverageScore)}</strong></div>
        <div class="metric"><span>CORRELATION</span><strong>\${clean(stack.correlationScore)}</strong></div>
      </div>

      <div class="volatility \${stackIntelVolClass(stack.volatilityMeter)}">
        \${clean(stack.volatilityMeter)}
      </div>

      <div class="stack-footer">
        <div><span>Pitcher Collapse</span><strong>\${clean(stack.pitcherCollapseProbability)}</strong></div>
        <div><span>Bullpen Collapse</span><strong>\${clean(stack.bullpenCollapseScore)}</strong></div>
      </div>

      <div class="lane">
        \${clean(stack.correlatedHrLane)} • \${clean(stack.sprayDistribution)}
      </div>
    </article>
  \`;
}

function renderCollapseAlertCard(alert) {
  return \`
    <article class="collapse-card">
      <div class="collapse-top">
        <div>
          <h3>\${clean(alert.opposingPitcher)}</h3>
          <p>\${clean(alert.team)} offense • \${clean(alert.venue)}</p>
        </div>

        <div class="collapse-label">\${clean(alert.collapseLabel)}</div>
      </div>

      <div class="collapse-grid">
        <div><span>Pitcher</span><strong>\${clean(alert.pitcherCollapseProbability)}</strong></div>
        <div><span>Bullpen</span><strong>\${clean(alert.bullpenCollapseScore)}</strong></div>
        <div><span>Weather</span><strong>\${clean(alert.weatherBoost)}</strong></div>
      </div>
    </article>
  \`;
}

function renderLeverageProfileCard(profile) {
  return \`
    <article class="leverage-card">
      <div class="lev-top">
        <div>
          <h3>\${clean(profile.team)}</h3>
          <p>\${clean(profile.players)}</p>
        </div>

        <div class="lev-grade">\${clean(profile.leverageProfile)}</div>
      </div>

      <div class="lev-score">\${clean(profile.leverageScore)}</div>

      <div class="lev-reason">\${clean(profile.reason)}</div>
    </article>
  \`;
}

function renderStackIntelligence2() {
  const stacks = state.stackIntel?.stacks || [];
  const alerts = state.collapseAlerts?.alerts || [];
  const leverage = state.stackLeverage?.profiles || [];

  return \`
    <section class="results-lab">
      <div class="results-hero">
        <div>
          <span>TEAM STACK INTELLIGENCE 2.0</span>
          <h2>Stack Lab</h2>
          <p>Correlated HR lanes, collapse probability, leverage profiles, volatility, and HR chain reaction scoring.</p>
        </div>

        <div class="results-scorebox"><strong>\${stacks.length}</strong><span>Stacks</span></div>
        <div class="results-scorebox"><strong>\${alerts.length}</strong><span>Collapse Alerts</span></div>
      </div>

      <div class="section-title">Top Stack Intelligence</div>
      <div class="stack-board">
        \${stacks.slice(0, 24).map(renderStackIntelligenceCard).join("") || \`<div class="empty">No Stack Intelligence 2.0 data found.</div>\`}
      </div>

      <div class="section-title" style="margin-top: 20px;">Pitcher Collapse Alerts</div>
      <div class="collapse-board">
        \${alerts.slice(0, 12).map(renderCollapseAlertCard).join("") || \`<div class="empty">No collapse alerts found.</div>\`}
      </div>

      <div class="section-title" style="margin-top: 20px;">Stack Leverage Profiles</div>
      <div class="leverage-board">
        \${leverage.slice(0, 12).map(renderLeverageProfileCard).join("") || \`<div class="empty">No leverage profiles found.</div>\`}
      </div>
    </section>
  \`;
}

`;

replaceOnce(
`function renderResultsBoard(data) {`,
`${stackLabFunctions}
function renderResultsBoard(data) {`
);

replaceOnce(
`  const [raw, updatedInfo, weatherRows, parkRows, statcastZones, pitchTypeDamage, handednessOverlays, launchAngleClusters, parkCarryVisuals, pitcherAttackZones, hotColdAttackRegions, stackRows] = await Promise.all([`,
`  const [raw, updatedInfo, weatherRows, parkRows, statcastZones, pitchTypeDamage, handednessOverlays, launchAngleClusters, parkCarryVisuals, pitcherAttackZones, hotColdAttackRegions, stackRows, stackIntelRows, stackLeverageRows, collapseAlertRows] = await Promise.all([`
);

replaceOnce(
`    loadTeamStacks()
  ]);`,
`    loadTeamStacks(),
    loadStackIntelligence2(),
    loadStackLeverageProfiles(),
    loadCollapseAlerts()
  ]);`
);

replaceOnce(
`  state.stacks = stackRows;`,
`  state.stacks = stackRows;
  state.stackIntel = stackIntelRows;
  state.stackLeverage = stackLeverageRows;
  state.collapseAlerts = collapseAlertRows;`
);

replaceOnce(
`  if (state.market === "results") {
    board.innerHTML = renderResultsBoard(raw);
    return;
  }`,
`  if (state.market === "results") {
    board.innerHTML = renderResultsBoard(raw);
    return;
  }

  if (state.market === "stack_lab") {
    board.innerHTML = renderStackIntelligence2();
    return;
  }`
);

replaceOnce(
`document.querySelectorAll("nav button").forEach(btn => {`,
`function ensureStackLabTab() {
  const tabs = document.querySelector(".tabs");

  if (!tabs || tabs.querySelector('[data-market="stack_lab"]')) return;

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.market = "stack_lab";
  button.textContent = "Stack Lab";

  tabs.appendChild(button);
}

ensureStackLabTab();

document.querySelectorAll("nav button").forEach(btn => {`
);

fs.writeFileSync(file, app);

console.log("Stack Lab UI patched into existing app.js safely.");
