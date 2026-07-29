(function(){
  function initAnalytics(){
    if (document.querySelector('script[data-tsl-vercel-analytics]')) return;

    window.va = window.va || function(){
      (window.vaq = window.vaq || []).push(arguments);
    };

    const script = document.createElement("script");
    script.defer = true;
    script.src = "/_vercel/insights/script.js";
    script.dataset.tslVercelAnalytics = "true";
    document.head.appendChild(script);
  }

  initAnalytics();

  const items = [
    ["Sign In","./account.html",["/account.html"]],
    ["How to Use","./how-to-use.html",["/how-to-use.html"]],
    ["Lab Notes","./blog.html",["/blog.html","/blog-hr-shortlist.html","/blog-pitcher-vulnerability.html","/blog-signal-stack.html"]],
    ["Slate","./mlb.html",["/mlb.html","/index.html","/"]],
    ["Full Board","./full-board.html",["/full-board.html"]],
    ["Matchup Lab","./matchup-lab.html",["/matchup-lab.html"]],
    ["Pitcher Vulnerability","./pitcher-vulnerability.html",["/pitcher-vulnerability.html"]],
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

  const primaryLabels = new Set(["Sign In", "Slate", "Results", "Weather", "AI Says"]);
  const primaryOrder = ["Sign In", "Slate", "Results", "Weather", "AI Says"];
  const protectedPaths = new Set([
    "/ai-hall-of-fame.html",
    "/ai-says.html",
    "/bullpen-collapse.html",
    "/command-center.html",
    "/full-board.html",
    "/heat-check.html",
    "/hr-decision-center.html",
    "/decision-center.html",
    "/live-game-center.html",
    "/live-heatmap.html",
    "/live-platform.html",
    "/matchup-lab.html",
    "/mlb.html",
    "/model-report.html",
    "/nba.html",
    "/nba-assists.html",
    "/nba-matchups.html",
    "/nba-points.html",
    "/nba-rebounds.html",
    "/nba-threes.html",
    "/nfl.html",
    "/pitcher-vulnerability.html",
    "/player-intelligence.html",
    "/power-zones.html",
    "/quick-target.html",
    "/streak-lab.html"
  ]);

  function itemIsActive(activePaths, path){
    return activePaths.includes(path);
  }

  function makeNavLink(label, href, activePaths, path){
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    if (href === "./account.html") {
      a.dataset.tslAccountLink = "true";
      a.classList.add("tsl-account-link");
    }
    if (itemIsActive(activePaths, path)) a.classList.add("active");
    return a;
  }

  function oldHeaderLooksLikeSiteNav(el){
    const t = (el.textContent || "").replace(/\s+/g," ").trim();
    return t.includes("The Slip Lab") || t.includes("THE SLIP LAB") || (
      t.includes("Full Board") &&
      t.includes("Power Zones") &&
      t.includes("AI Says")
    );
  }

  function hideOldHeaders(){
    document.querySelectorAll("body > .topbar, body > header").forEach(el => {
      if (!el.classList.contains("tsl-site-header") && oldHeaderLooksLikeSiteNav(el)) {
        el.classList.add("tsl-header-hidden");
      }
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
    brand.innerHTML = "The Slip <span>Lab</span>";

    const nav = document.createElement("nav");
    nav.className = "tsl-nav";

    const primaryItems = primaryOrder
      .map(label => items.find(([itemLabel]) => itemLabel === label))
      .filter(Boolean);
    const menuItems = items.filter(([label]) => !primaryLabels.has(label));
    const menuHasActiveItem = menuItems.some(([, , activePaths]) => itemIsActive(activePaths, path));

    primaryItems.forEach(([label, href, activePaths]) => {
      nav.appendChild(makeNavLink(label, href, activePaths, path));
    });

    const menu = document.createElement("div");
    menu.className = "tsl-nav-menu";

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "tsl-nav-menu-button";
    menuButton.setAttribute("aria-haspopup", "true");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.innerHTML = `More <span aria-hidden="true">▾</span>`;
    if (menuHasActiveItem) menuButton.classList.add("active");

    const panel = document.createElement("div");
    panel.className = "tsl-nav-menu-panel";
    panel.setAttribute("role", "menu");

    menuItems.forEach(([label, href, activePaths]) => {
      const a = makeNavLink(label, href, activePaths, path);
      a.setAttribute("role", "menuitem");
      panel.appendChild(a);
    });

    function positionMenuPanel(){
      const rect = menuButton.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height || window.innerHeight || 700;
      const top = Math.max(84, Math.round(rect.bottom + 8));
      const maxHeight = Math.max(220, Math.round(viewportHeight - top - 16));
      panel.style.setProperty("--tsl-nav-menu-top", `${top}px`);
      panel.style.setProperty("--tsl-nav-menu-max-height", `${maxHeight}px`);
    }

    function setMenuOpen(open){
      if (open) positionMenuPanel();
      menu.classList.toggle("open", open);
      menuButton.setAttribute("aria-expanded", open ? "true" : "false");
    }

    menuButton.addEventListener("click", event => {
      event.stopPropagation();
      setMenuOpen(!menu.classList.contains("open"));
    });

    document.addEventListener("click", event => {
      if (!menu.contains(event.target)) setMenuOpen(false);
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") setMenuOpen(false);
    });

    window.addEventListener("resize", () => {
      if (menu.classList.contains("open")) positionMenuPanel();
    });

    window.visualViewport?.addEventListener("resize", () => {
      if (menu.classList.contains("open")) positionMenuPanel();
    });

    menu.appendChild(menuButton);
    menu.appendChild(panel);
    nav.appendChild(menu);

    inner.appendChild(brand);
    inner.appendChild(nav);
    header.appendChild(inner);
    return header;
  }

  function init(){
    if (document.querySelector(".tsl-site-header")) return;
    hideOldHeaders();
    document.body.insertBefore(buildHeader(), document.body.firstChild);
    if (!document.querySelector('script[data-tsl-account-client]')) {
      const accountScript = document.createElement("script");
      accountScript.type = "module";
      accountScript.src = "./assets/account-client.js";
      accountScript.dataset.tslAccountClient = "true";
      document.head.appendChild(accountScript);
    }
    if (protectedPaths.has(window.location.pathname) && !document.querySelector('script[data-tsl-access-gate]')) {
      const gateScript = document.createElement("script");
      gateScript.src = "./assets/access-gate.js";
      gateScript.dataset.tslAccessGate = "true";
      document.head.appendChild(gateScript);
    }
    if (!document.querySelector('script[data-tsl-abandoned-signup]')) {
      const reminderScript = document.createElement("script");
      reminderScript.src = "./assets/abandoned-signup.js";
      reminderScript.dataset.tslAbandonedSignup = "true";
      document.body.appendChild(reminderScript);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
