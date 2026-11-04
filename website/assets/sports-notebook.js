const SPORTS = [
  ["MLB", "mlb.html"], ["WNBA", "wnba.html"], ["NFL", "nfl.html"],
  ["CFB", "cfb.html"], ["NBA", "nba.html"], ["NHL", "nhl.html"]
];

const currentFile = location.pathname.split("/").pop() || "index.html";
document.body.classList.add("sports-notebook");
const nav = document.createElement("nav");
nav.className = "sport-notebook-nav";
nav.setAttribute("aria-label", "Choose a sport");
nav.innerHTML = `<strong>Analyst’s notebook</strong>${SPORTS.map(([label, file]) => `<a href="./${file}" class="${currentFile === file ? "active" : ""}" ${currentFile === file ? 'aria-current="page"' : ""}>${label}</a>`).join("")}`;
const nativeHeader = document.querySelector(".topbar,.nhl-topbar,.tsl-site-header");
(nativeHeader?.parentNode || document.body).insertBefore(nav, nativeHeader?.nextSibling || document.body.firstChild);
