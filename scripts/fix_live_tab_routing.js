import fs from "fs";
import path from "path";

const appPath = path.join(process.cwd(), "website/app.js");

let app = fs.readFileSync(appPath, "utf8");

const replacements = [
  {
    from: `
  if (state.market === "live_center") {
    renderPlaceholder(
      "Live Center",
      "MLB Live Center data coming soon."
    );
    return;
  }`,
    to: `
  if (state.market === "live_center") {
    window.location.href = "./command-center.html";
    return;
  }`
  },

  {
    from: `
  if (state.market === "heatmap") {
    renderPlaceholder(
      "Heatmap",
      "MLB Heatmap data coming soon."
    );
    return;
  }`,
    to: `
  if (state.market === "heatmap") {
    window.location.href = "./live-heatmap.html";
    return;
  }`
  },

  {
    from: `
  if (state.market === "bullpen") {
    renderPlaceholder(
      "Bullpen",
      "MLB Bullpen data coming soon."
    );
    return;
  }`,
    to: `
  if (state.market === "bullpen") {
    window.location.href = "./bullpen-collapse.html";
    return;
  }`
  },

  {
    from: `
  if (state.market === "players_live") {
    renderPlaceholder(
      "Players Live",
      "MLB Players Live data coming soon."
    );
    return;
  }`,
    to: `
  if (state.market === "players_live") {
    window.location.href = "./player-intelligence.html";
    return;
  }`
  }
];

for (const item of replacements) {
  app = app.replace(item.from, item.to);
}

fs.writeFileSync(appPath, app);

console.log("");
console.log("LIVE TAB ROUTING FIXED");
console.log(appPath);
