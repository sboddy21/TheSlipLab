import fs from "fs";

const file = "website/app.js";
let app = fs.readFileSync(file, "utf8");

const oldBlock = `function attachSearchEvents() {
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
}`;

const newBlock = `let searchRenderTimer = null;

function attachSearchEvents() {
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
}`;

if (!app.includes(oldBlock)) {
  throw new Error("attachSearchEvents block not found");
}

app = app.replace(oldBlock, newBlock);

fs.writeFileSync(file, app);

console.log("Fixed player search typing debounce.");
