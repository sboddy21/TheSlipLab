(function () {
  const links = [
    ["index.html", "Slate"],
    ["full-board.html", "Full Board"],
    ["matchup-lab.html", "Matchup Lab"],
    ["power-zones.html", "Power Zones"],
    ["quick-target.html", "Quick Target"],
    ["heat-check.html", "Heat Check"],
    ["streak-lab.html", "Streak Lab"],
    ["results.html", "Results"],
    ["hr-decision-center.html", "Decision Center"]
  ];

  const current = location.pathname.split("/").pop() || "index.html";

  const old = document.querySelector(".slip-mlb-nav");
  if (old) old.remove();

  const nav = document.createElement("nav");
  nav.className = "slip-mlb-nav";

  nav.innerHTML = links.map(([href, label]) => {
    const active = current === href ? "active" : "";
    return `<a class="${active}" href="./${href}">${label}</a>`;
  }).join("");

  const style = document.createElement("style");
  style.textContent = `
    .slip-mlb-nav {
      max-width: 1380px;
      margin: 0 auto;
      padding: 18px 24px 8px;
      display: flex;
      gap: 22px;
      align-items: center;
      overflow-x: auto;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: #050505;
    }

    .slip-mlb-nav a {
      color: #9a9aa3;
      text-decoration: none;
      font-size: 13px;
      font-weight: 950;
      letter-spacing: .08em;
      text-transform: uppercase;
      white-space: nowrap;
      padding: 14px 0;
      border-bottom: 3px solid transparent;
    }

    .slip-mlb-nav a:hover {
      color: #ffffff;
    }

    .slip-mlb-nav a.active {
      color: #ffffff;
      border-bottom-color: #9cff38;
    }
  `;
  document.head.appendChild(style);

  document.body.prepend(nav);
})();
