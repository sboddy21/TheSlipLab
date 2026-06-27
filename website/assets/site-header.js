(function(){
  const items = [
    ["Slate","./mlb.html",["/mlb.html","/"]],
    ["Full Board","./full-board.html",["/full-board.html"]],
    ["Matchup Lab","./matchup-lab.html",["/matchup-lab.html"]],
    ["Power Zones","./power-zones.html",["/power-zones.html"]],
    ["Quick Target","./quick-target.html",["/quick-target.html"]],
    ["Heat Check","./heat-check.html",["/heat-check.html"]],
    ["Streak Lab","./streak-lab.html",["/streak-lab.html"]],
    ["Weather","./weather.html",["/weather.html"]],
    ["Results","./results.html",["/results.html"]],
    ["Decision Center","./hr-decision-center.html",["/hr-decision-center.html","/decision-center.html"]],
    ["AI Says","./ai-says.html",["/ai-says.html"]],
    ["Hall of Fame","./ai-hall-of-fame.html",["/ai-hall-of-fame.html"]]
  ];

  function cleanOldHeaders(){
    document.querySelectorAll(".tsl-site-header").forEach(el => el.remove());
    document.querySelectorAll(".topbar").forEach(el => {
      if ((el.textContent || "").includes("The Slip Lab")) el.remove();
    });
    document.querySelectorAll("body > header").forEach(el => {
      const t = el.textContent || "";
      if (t.includes("The Slip Lab") || t.includes("THE SLIP LAB")) el.remove();
    });
  }

  function buildHeader(){
    const path = window.location.pathname;
    const header = document.createElement("header");
    header.className = "tsl-site-header";

    const inner = document.createElement("div");
    inner.className = "tsl-site-header-inner";

    const brand = document.createElement("a");
    brand.className = "tsl-brand";
    brand.href = "./index.html";
    brand.textContent = "The Slip Lab";

    const nav = document.createElement("nav");
    nav.className = "tsl-nav";

    items.forEach(([label, href, activePaths]) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      if (activePaths.includes(path)) a.className = "active";
      nav.appendChild(a);
    });

    inner.appendChild(brand);
    inner.appendChild(nav);
    header.appendChild(inner);
    return header;
  }

  function init(){
    cleanOldHeaders();
    document.body.insertBefore(buildHeader(), document.body.firstChild);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
