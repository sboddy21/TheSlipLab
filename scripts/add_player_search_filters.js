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
`  searchQuery: ""`,
`  searchQuery: "",
  searchTeam: "all",
  searchGame: "all",
  searchPosition: "all",
  searchSort: "name"`
);

replaceOnce(
`function filterRowsBySearch(rows) {
  const query = clean(state.searchQuery, "").toLowerCase().trim();

  if (!query) return rows;

  return rows.filter(row => rowSearchText(row).includes(query));
}`,
`function uniqueValues(rows, getter) {
  return [...new Set(rows.map(getter).map(value => clean(value, "")).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function sortSearchRows(rows) {
  const sorted = [...rows];

  if (state.searchSort === "team") {
    sorted.sort((a, b) =>
      clean(a.team, "").localeCompare(clean(b.team, "")) ||
      clean(a.player, "").localeCompare(clean(b.player, ""))
    );
  } else if (state.searchSort === "game") {
    sorted.sort((a, b) =>
      new Date(a.gameDate || 0) - new Date(b.gameDate || 0) ||
      clean(a.game, "").localeCompare(clean(b.game, ""))
    );
  } else if (state.searchSort === "position") {
    sorted.sort((a, b) =>
      clean(a.position || a.positionType, "").localeCompare(clean(b.position || b.positionType, "")) ||
      clean(a.player, "").localeCompare(clean(b.player, ""))
    );
  } else {
    sorted.sort((a, b) =>
      clean(a.player, "").localeCompare(clean(b.player, ""))
    );
  }

  return sorted;
}

function filterRowsBySearch(rows) {
  const query = clean(state.searchQuery, "").toLowerCase().trim();

  let filtered = rows;

  if (query) {
    filtered = filtered.filter(row => rowSearchText(row).includes(query));
  }

  if (state.searchTeam !== "all") {
    filtered = filtered.filter(row => clean(row.team, "") === state.searchTeam);
  }

  if (state.searchGame !== "all") {
    filtered = filtered.filter(row => clean(row.game, "") === state.searchGame);
  }

  if (state.searchPosition !== "all") {
    filtered = filtered.filter(row => clean(row.position || row.positionType, "") === state.searchPosition);
  }

  return sortSearchRows(filtered);
}`
);

replaceOnce(
`function renderSearchBar(label = "Search players, teams, games, or pitchers") {
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
}`,
`function optionList(values, activeValue) {
  return values.map(value => \`
    <option value="\${clean(value)}" \${value === activeValue ? "selected" : ""}>
      \${clean(value)}
    </option>
  \`).join("");
}

function renderSearchBar(label = "Search players, teams, games, or pitchers", rows = state.rows) {
  const teams = uniqueValues(rows, row => row.team);
  const games = uniqueValues(rows, row => row.game);
  const positions = uniqueValues(rows, row => row.position || row.positionType);

  return \`
    <section class="player-search-control-panel">
      <div class="player-search-bar">
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
      </div>

      <div class="player-filter-grid">
        <label>
          <span>Team</span>
          <select id="player-filter-team">
            <option value="all">All Teams</option>
            \${optionList(teams, state.searchTeam)}
          </select>
        </label>

        <label>
          <span>Game</span>
          <select id="player-filter-game">
            <option value="all">All Games</option>
            \${optionList(games, state.searchGame)}
          </select>
        </label>

        <label>
          <span>Position</span>
          <select id="player-filter-position">
            <option value="all">All Positions</option>
            \${optionList(positions, state.searchPosition)}
          </select>
        </label>

        <label>
          <span>Sort</span>
          <select id="player-filter-sort">
            <option value="name" \${state.searchSort === "name" ? "selected" : ""}>Name</option>
            <option value="team" \${state.searchSort === "team" ? "selected" : ""}>Team</option>
            <option value="game" \${state.searchSort === "game" ? "selected" : ""}>Game Time</option>
            <option value="position" \${state.searchSort === "position" ? "selected" : ""}>Position</option>
          </select>
        </label>
      </div>
    </section>
  \`;
}`
);

replaceOnce(
`    \${renderSearchBar("Search all MLB players")}`,
`    \${renderSearchBar("Search all MLB players", rows)}`
);

replaceOnce(
`    \${renderSearchBar()}`,
`    \${renderSearchBar("Search players, teams, games, or pitchers", rows)}`
);

replaceOnce(
`function attachSearchEvents() {
  const input = document.getElementById("player-search-input");
  const clear = document.getElementById("player-search-clear");

  if (input && !input.dataset.bound) {
    input.dataset.bound = "true";

    input.addEventListener("input", event => {
      state.searchQuery = event.target.value;

      clearTimeout(searchRenderTimer);

      searchRenderTimer = setTimeout(() => {
        render().then(() => {
          const nextInput = document.getElementById("player-search-input");

          if (nextInput) {
            nextInput.focus();
            nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
          }
        }).catch(showAppError);
      }, 350);
    });
  }

  if (clear && !clear.dataset.bound) {
    clear.dataset.bound = "true";

    clear.addEventListener("click", () => {
      state.searchQuery = "";
      render().catch(showAppError);
    });
  }
}`,
`function attachSearchEvents() {
  const input = document.getElementById("player-search-input");
  const clear = document.getElementById("player-search-clear");
  const team = document.getElementById("player-filter-team");
  const game = document.getElementById("player-filter-game");
  const position = document.getElementById("player-filter-position");
  const sort = document.getElementById("player-filter-sort");

  if (input && !input.dataset.bound) {
    input.dataset.bound = "true";

    input.addEventListener("input", event => {
      state.searchQuery = event.target.value;

      clearTimeout(searchRenderTimer);

      searchRenderTimer = setTimeout(() => {
        render().then(() => {
          const nextInput = document.getElementById("player-search-input");

          if (nextInput) {
            nextInput.focus();
            nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
          }
        }).catch(showAppError);
      }, 350);
    });
  }

  if (clear && !clear.dataset.bound) {
    clear.dataset.bound = "true";

    clear.addEventListener("click", () => {
      state.searchQuery = "";
      state.searchTeam = "all";
      state.searchGame = "all";
      state.searchPosition = "all";
      state.searchSort = "name";
      render().catch(showAppError);
    });
  }

  if (team && !team.dataset.bound) {
    team.dataset.bound = "true";
    team.addEventListener("change", event => {
      state.searchTeam = event.target.value;
      render().catch(showAppError);
    });
  }

  if (game && !game.dataset.bound) {
    game.dataset.bound = "true";
    game.addEventListener("change", event => {
      state.searchGame = event.target.value;
      render().catch(showAppError);
    });
  }

  if (position && !position.dataset.bound) {
    position.dataset.bound = "true";
    position.addEventListener("change", event => {
      state.searchPosition = event.target.value;
      render().catch(showAppError);
    });
  }

  if (sort && !sort.dataset.bound) {
    sort.dataset.bound = "true";
    sort.addEventListener("change", event => {
      state.searchSort = event.target.value;
      render().catch(showAppError);
    });
  }
}`
);

fs.writeFileSync(file, app);

console.log("Player search filters added.");
