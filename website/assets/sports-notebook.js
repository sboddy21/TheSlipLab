const SPORTS = [
  ["MLB", "mlb.html", false], ["WNBA", "wnba.html", false], ["NFL", "nfl.html", true],
  ["CFB", "cfb.html", true], ["NBA", "nba.html", true], ["NHL", "nhl.html", true], ["NCAAM", "ncaam.html", true]
];

const currentFile = location.pathname.split("/").pop() || "index.html";
document.body.classList.add("sports-notebook");
const nav = document.createElement("nav");
nav.className = "sport-notebook-nav";
nav.setAttribute("aria-label", "Choose a sport");
nav.innerHTML = `<strong>Analyst’s notebook</strong>${SPORTS.map(([label, file, enabled]) => enabled
  ? `<a href="./${file}" class="${currentFile === file ? "active" : ""}" ${currentFile === file ? 'aria-current="page"' : ""}>${label}</a>`
  : `<span class="unavailable" aria-disabled="true" title="Currently unavailable">${label}</span>`).join("")}`;
const nativeHeader = document.querySelector(".topbar,.nhl-topbar,.tsl-site-header");
(nativeHeader?.parentNode || document.body).insertBefore(nav, nativeHeader?.nextSibling || document.body.firstChild);
