import fs from "fs";
import path from "path";

const appPath = path.join(process.cwd(), "website/app.js");

let app = fs.readFileSync(appPath, "utf8");

if (!app.includes('data-market="live_center"')) {

app = app.replace(
`  if (!tabs.querySelector('[data-market="player_search"]')) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.market = "player_search";
    button.textContent = "Player Search";
    tabs.appendChild(button);
  }`,
`  if (!tabs.querySelector('[data-market="player_search"]')) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.market = "player_search";
    button.textContent = "Player Search";
    tabs.appendChild(button);
  }

  if (!tabs.querySelector('[data-market="live_center"]')) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.market = "live_center";
    button.textContent = "Live Center";
    tabs.appendChild(button);
  }

  if (!tabs.querySelector('[data-market="heatmap"]')) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.market = "heatmap";
    button.textContent = "Heatmap";
    tabs.appendChild(button);
  }

  if (!tabs.querySelector('[data-market="bullpen"]')) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.market = "bullpen";
    button.textContent = "Bullpen";
    tabs.appendChild(button);
  }

  if (!tabs.querySelector('[data-market="players_live"]')) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.market = "players_live";
    button.textContent = "Players+";
    tabs.appendChild(button);
  }`
);

}

if (!app.includes("LIVE PLATFORM TAB ROUTES")) {

app = app.replace(
`  if (state.market === "stack_lab") {
    body.innerHTML = renderStackIntelligence2();
    return;
  }`,
`  if (state.market === "stack_lab") {
    body.innerHTML = renderStackIntelligence2();
    return;
  }

  /*
    LIVE PLATFORM TAB ROUTES
  */

  if (state.market === "live_center") {
    window.location.href = "./command-center.html";
    return;
  }

  if (state.market === "heatmap") {
    window.location.href = "./live-heatmap.html";
    return;
  }

  if (state.market === "bullpen") {
    window.location.href = "./bullpen-collapse.html";
    return;
  }

  if (state.market === "players_live") {
    window.location.href = "./player-intelligence.html";
    return;
  }`
);

}

fs.writeFileSync(appPath, app);

console.log("");
console.log("LIVE PLATFORM TABS ADDED");
console.log(appPath);
