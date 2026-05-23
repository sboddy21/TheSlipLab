import fs from "fs";
import path from "path";

const appPath = path.join(process.cwd(), "website/app.js");
let app = fs.readFileSync(appPath, "utf8");

const forceRouter = `
/* FORCE LIVE PLATFORM TAB LINKS */
document.addEventListener("click", function (event) {
  const button = event.target.closest("[data-market]");
  if (!button) return;

  const routes = {
    live_center: "./command-center.html",
    heatmap: "./live-heatmap.html",
    bullpen: "./bullpen-collapse.html",
    players_live: "./player-intelligence.html"
  };

  const route = routes[button.dataset.market];

  if (route) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    window.location.href = route;
  }
}, true);
`;

if (!app.includes("FORCE LIVE PLATFORM TAB LINKS")) {
  app = forceRouter + "\n" + app;
}

fs.writeFileSync(appPath, app);

console.log("Forced live tab links added.");
