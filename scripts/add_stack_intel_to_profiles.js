import fs from "fs";

const file = "website/app.js";
let app = fs.readFileSync(file, "utf8");

function replaceOnce(find, replace) {
  if (!app.includes(find)) {
    throw new Error(`Missing target`);
  }

  app = app.replace(find, replace);
}

if (!app.includes("function findPlayerStackIntelligence(row)")) {
  const helperBlock = `
function findPlayerStackIntelligence(row) {
  const player = clean(row.player, "");
  const team = clean(row.team, "");

  const stacks = state.stackIntel?.stacks || [];
  const leverage = state.stackLeverage?.profiles || [];
  const alerts = state.collapseAlerts?.alerts || [];

  const playerStacks = stacks
    .filter(stack =>
      clean(stack.team, "") === team &&
      clean(stack.players, "").toLowerCase().includes(player.toLowerCase())
    )
    .sort((a, b) => number(b.finalStackScore) - number(a.finalStackScore));

  const playerLeverage = leverage
    .filter(profile =>
      clean(profile.team, "") === team &&
      clean(profile.players, "").toLowerCase().includes(player.toLowerCase())
    )
    .sort((a, b) => number(b.leverageScore) - number(a.leverageScore));

  const collapse = alerts.find(alert =>
    clean(alert.team, "") === team &&
    clean(alert.game, "") === clean(row.game, "")
  );

  return {
    topStack: playerStacks[0] || null,
    stacks: playerStacks,
    leverage: playerLeverage[0] || null,
    collapse: collapse || null
  };
}

function renderPlayerStackIntelligence(row) {
  const intel = findPlayerStackIntelligence(row);
  const stack = intel.topStack;
  const leverage = intel.leverage;
  const collapse = intel.collapse;

  if (!stack && !leverage && !collapse) {
    return \`
      <div class="profile-note">
        No Stack Intelligence 2.0 match found for this player yet.
      </div>
    \`;
  }

  return \`
    <div class="player-intel-card">
      <div class="player-intel-head">
        <div>
          <strong>Stack Intelligence 2.0</strong>
          <span>Player level stack, leverage, collapse, and chain reaction read</span>
        </div>

        <div class="player-intel-grade">
          \${clean(stack?.stackGrade || leverage?.leverageProfile || collapse?.collapseLabel || "WATCH")}
        </div>
      </div>

      <div class="player-intel-grid">
        <div><span>Stack Score</span><strong>\${clean(stack?.finalStackScore)}</strong></div>
        <div><span>Stack Size</span><strong>\${stack?.stackSize ? stack.stackSize + " Man" : "--"}</strong></div>
        <div><span>Chain Reaction</span><strong>\${clean(stack?.hrChainReactionProbability)}</strong></div>
        <div><span>Volatility</span><strong>\${clean(stack?.volatilityMeter)}</strong></div>
        <div><span>Leverage</span><strong>\${clean(leverage?.leverageScore || stack?.leverageScore)}</strong></div>
        <div><span>Pitcher Collapse</span><strong>\${clean(collapse?.pitcherCollapseProbability || stack?.pitcherCollapseProbability)}</strong></div>
        <div><span>Bullpen Collapse</span><strong>\${clean(collapse?.bullpenCollapseScore || stack?.bullpenCollapseScore)}</strong></div>
        <div><span>Lane</span><strong>\${clean(stack?.correlatedHrLane)}</strong></div>
      </div>

      <div class="player-intel-read">
        \${stack
          ? \`\${clean(row.player)} is part of a \${clean(stack.stackSize)} man \${clean(stack.correlatedHrLane)} with \${clean(stack.hrChainReactionProbability)} chain reaction probability.\`
          : \`Stack read is still developing for this player.\`
        }
      </div>
    </div>
  \`;
}

`;

  replaceOnce("function openPlayerProfile(index) {", `${helperBlock}\nfunction openPlayerProfile(index) {`);
}

if (!app.includes("<h3>Stack Intelligence 2.0</h3>")) {
  replaceOnce(
`    <div class="profile-note">\${clean(row.note, "No matchup note available yet.")}</div>

    \${renderBallparkWeather(row.venue)}`,
`    <div class="profile-note">\${clean(row.note, "No matchup note available yet.")}</div>

    <h3>Stack Intelligence 2.0</h3>
    \${renderPlayerStackIntelligence(row)}

    \${renderBallparkWeather(row.venue)}`
  );
}

fs.writeFileSync(file, app);

console.log("Stack Intelligence added to player profiles safely.");
