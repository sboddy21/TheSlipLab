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
`  collapseAlerts: null`,
`  collapseAlerts: null,
  searchQuery: ""`
);

replaceOnce(
`    stack_lab: "data/team_stack_intelligence_2.json"`,
`    stack_lab: "data/team_stack_intelligence_2.json",
    player_search: "data/mlb_player_pool.json"`
);

replaceOnce(
`function renderGroupedHomeRunBoard(rows) {`,
`function rowSearchText(row) {
  return [
    row.player,
    row.team,
    row.opponent,
    row.game,
    row.venue,
    row.opposingPitcher,
    row.opposingProbablePitcher,
    row.position,
    row.positionType
  ].map(value => clean(value, "")).join(" ").toLowerCase();
}

function filterRowsBySearch(rows) {
  const query = clean(state.searchQuery, "").toLowerCase().trim();

  if (!query) return rows;

  return rows.filter(row => rowSearchText(row).includes(query));
}

function renderSearchBar(label = "Search players, teams, games, or pitchers") {
  return \`
    <section class="player-search-bar">
      <input
        id="player-search-input"
        type="search"
        value="\${clean(state.searchQuery, "")}"
        placeholder="\${label}"
        autocomplete="off"
      />

      <button type="button" id="player-search-clear">
        Clear
      </button>
    </section>
  \`;
}

function renderPlayerDirectoryCard(row, index) {
  return \`
    <article class="card clickable-card" data-profile-index="\${index}">
      <div class="rank">#\${index + 1}</div>

      <div>
        <div class="player">\${clean(row.player)}</div>
        <div class="meta">\${clean(row.team)} • \${clean(row.position || row.positionType || "Hitter")}</div>
        <div class="meta">\${clean(row.game)} • \${formatGameTime(row.gameDate)}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Opponent</div>
        <div class="stat-value">\${clean(row.opponent)}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Pitcher</div>
        <div class="stat-value">\${clean(row.opposingProbablePitcher || row.opposingPitcher || "TBD")}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Side</div>
        <div class="stat-value">\${clean(row.homeAway)}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Player ID</div>
        <div class="stat-value">\${clean(row.playerId)}</div>
      </div>
    </article>
  \`;
}

function renderPlayerSearchBoard(rows) {
  const filtered = filterRowsBySearch(rows);

  return \`
    \${renderSearchBar("Search all MLB players")}

    <div class="board-header player-directory-header">
      <div>
        <h3>Player Directory</h3>
        <p>\${filtered.length} of \${rows.length} players shown</p>
      </div>
    </div>

    <div class="main-board-grid">
      \${filtered.length
        ? filtered.map((row, index) => renderPlayerDirectoryCard(row, state.rows.indexOf(row))).join("")
        : \`<div class="empty">No players match that search.</div>\`}
    </div>
  \`;
}

function renderGroupedHomeRunBoard(rows) {`
);

replaceOnce(
`  const rows = state.market === "games"
    ? raw.games || []
    : state.market === "weather"
      ? raw.weather || []
      : state.market === "results"
        ? raw.results || []
        : Array.isArray(raw)
          ? raw
          : [];`,
`  const rows = state.market === "games"
    ? raw.games || []
    : state.market === "weather"
      ? raw.weather || []
      : state.market === "results"
        ? raw.results || []
        : state.market === "player_search"
          ? raw.players || []
          : Array.isArray(raw)
            ? raw
            : [];`
);

replaceOnce(
`  if (state.market === "stack_lab") {
    board.innerHTML = renderStackIntelligence2();
    return;
  }`,
`  if (state.market === "stack_lab") {
    board.innerHTML = renderStackIntelligence2();
    return;
  }

  if (state.market === "player_search") {
    board.innerHTML = renderPlayerSearchBoard(rows);
    attachSearchEvents();
    return;
  }`
);

replaceOnce(
`  board.innerHTML = state.market === "home_runs"
    ? renderGroupedHomeRunBoard(rows)
    : \`
      <div class="main-board-grid">
        \${rows.map((row, index) => renderPlayerBoardCard(row, index)).join("")}
      </div>
    \`;`,
`  const filteredRows = filterRowsBySearch(rows);

  board.innerHTML = \`
    \${renderSearchBar()}
    \${state.market === "home_runs"
      ? renderGroupedHomeRunBoard(filteredRows)
      : \`
        <div class="main-board-grid">
          \${filteredRows.map((row, index) => renderPlayerBoardCard(row, state.rows.indexOf(row))).join("")}
        </div>
      \`}
  \`;

  attachSearchEvents();`
);

replaceOnce(
`function ensureStackLabTab() {
  const tabs = document.querySelector(".tabs");

  if (!tabs || tabs.querySelector('[data-market="stack_lab"]')) return;

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.market = "stack_lab";
  button.textContent = "Stack Lab";

  tabs.appendChild(button);
}

ensureStackLabTab();`,
`function ensureExtraTabs() {
  const tabs = document.querySelector(".tabs");

  if (!tabs) return;

  if (!tabs.querySelector('[data-market="stack_lab"]')) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.market = "stack_lab";
    button.textContent = "Stack Lab";
    tabs.appendChild(button);
  }

  if (!tabs.querySelector('[data-market="player_search"]')) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.market = "player_search";
    button.textContent = "Player Search";
    tabs.appendChild(button);
  }
}

function attachSearchEvents() {
  const input = document.getElementById("player-search-input");
  const clear = document.getElementById("player-search-clear");

  if (input && !input.dataset.bound) {
    input.dataset.bound = "true";

    input.addEventListener("input", event => {
      state.searchQuery = event.target.value;
      render().catch(showAppError);
    });
  }

  if (clear && !clear.dataset.bound) {
    clear.dataset.bound = "true";

    clear.addEventListener("click", () => {
      state.searchQuery = "";
      render().catch(showAppError);
    });
  }
}

ensureExtraTabs();`
);

fs.writeFileSync(file, app);

console.log("Player Search added safely.");
