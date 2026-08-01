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
    ["Disclaimer","./disclaimer.html",["/disclaimer.html"]],
    ["WNBA","./wnba.html",["/wnba.html"]],
    ["Slate","./mlb.html",["/mlb.html","/index.html","/"]],
    ["Full Board","./full-board.html",["/full-board.html"]],
    ["Matchup Lab","./matchup-lab.html",["/matchup-lab.html"]],
    ["Pitcher Vulnerability","./pitcher-vulnerability.html",["/pitcher-vulnerability.html"]],
    ["Power Zones","./power-zones.html",["/power-zones.html"]],
    ["Weather","./weather.html",["/weather.html"]],
    ["Results","./results.html",["/results.html"]],
    ["Decision Center","./hr-decision-center.html",["/hr-decision-center.html","/decision-center.html"]],
    ["AI Says","./ai-says.html",["/ai-says.html"]],
    ["Hall of Fame","./ai-hall-of-fame.html",["/ai-hall-of-fame.html"]]
  ];

  const primaryLabels = new Set(["Sign In", "Slate", "Results", "Weather", "AI Says"]);
  const primaryOrder = ["Sign In", "Slate", "Results", "Weather", "AI Says"];
  const wnbaItems = [
    ["Slate","./wnba.html",["/wnba.html"]],
    ["Results","./wnba-results.html",["/wnba-results.html"]],
    ["AI Says","./wnba-ai-says.html",["/wnba-ai-says.html"]],
    ["How to Use","./how-to-use.html",["/how-to-use.html"]],
    ["Disclaimer","./disclaimer.html",["/disclaimer.html"]],
    ["Full Board","./wnba-full-board.html",["/wnba-full-board.html"]],
    ["Quick Target","./wnba-quick-target.html",["/wnba-quick-target.html"]]
  ];
  const wnbaPrimaryOrder = ["Slate", "Results", "AI Says"];
  const protectedPaths = new Set([
    "/ai-hall-of-fame.html",
    "/ai-says.html",
    "/bullpen-collapse.html",
    "/command-center.html",
    "/full-board.html",
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
    "/wnba.html",
    "/wnba-results.html",
    "/wnba-ai-says.html",
    "/wnba-full-board.html",
    "/wnba-quick-target.html",
    "/nfl.html",
    "/pitcher-vulnerability.html",
    "/player-intelligence.html",
    "/power-zones.html",
    "/tags.html"
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
    const wnbaSection = path === "/wnba.html" || path.startsWith("/wnba-");
    const navItems = wnbaSection ? wnbaItems : items;
    const navPrimaryOrder = wnbaSection ? wnbaPrimaryOrder : primaryOrder;
    const navPrimaryLabels = new Set(navPrimaryOrder);
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

    const primaryItems = navPrimaryOrder
      .map(label => navItems.find(([itemLabel]) => itemLabel === label))
      .filter(Boolean);
    const menuItems = navItems.filter(([label]) => !navPrimaryLabels.has(label));
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

  function buildLegalNotice(){
    const notice = document.createElement("aside");
    notice.className = "tsl-legal-notice";
    notice.setAttribute("aria-label", "Important informational-use notice");
    notice.innerHTML = `
      <div class="tsl-legal-notice-inner">
        <strong>Informational use only.</strong>
        <span>The Slip Lab is a sports analytics and educational platform—not a sportsbook or gambling operator. We do not accept or place wagers, and no model output guarantees an outcome.</span>
        <a href="./disclaimer.html">Read full disclaimer</a>
      </div>`;
    return notice;
  }

  function buildFooter(){
    const footer = document.createElement("footer");
    footer.className = "tsl-site-footer";
    footer.innerHTML = `
      <div class="tsl-site-footer-inner">
        <a class="tsl-site-footer-brand" href="./index.html">The Slip <span>Lab</span></a>
        <nav class="tsl-site-footer-links" aria-label="Footer navigation">
          <a href="./how-to-use.html">How to Use</a>
          <a href="./blog.html">Lab Notes</a>
          <a href="./mlb.html">Slate</a>
          <a href="./results.html">Results</a>
          <a href="./ai-says.html">AI Says</a>
        </nav>
      </div>
    `;
    return footer;
  }

  function init(){
    if (document.querySelector(".tsl-site-header")) return;
    hideOldHeaders();
    const header = buildHeader();
    document.body.insertBefore(header, document.body.firstChild);
    header.insertAdjacentElement("afterend", buildLegalNotice());
    if (!document.querySelector(".tsl-site-footer")) {
      document.body.appendChild(buildFooter());
    }
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
