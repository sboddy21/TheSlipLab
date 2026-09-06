(function(){
  const THEME_KEY = "tsl-theme";

  function preferredTheme(){
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return document.body?.classList.contains("tsl-editorial") ? "light" : "dark";
  }

  function applyTheme(theme){
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelectorAll("[data-tsl-theme-toggle]").forEach(button => {
      const next = theme === "dark" ? "light" : "dark";
      button.setAttribute("aria-label", `Switch to ${next} mode`);
      button.setAttribute("title", `Switch to ${next} mode`);
      button.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
      button.innerHTML = `<span aria-hidden="true">${theme === "dark" ? "☀" : "☾"}</span><span class="tsl-theme-label">${next === "dark" ? "Dark" : "Light"}</span>`;
    });
  }

  applyTheme(preferredTheme());

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

  const mlbItems = [
    ["Sign In","./account.html",["/account.html"]],
    ["Disclaimer","./disclaimer.html",["/disclaimer.html"]],
    ["Slate","./mlb.html",["/mlb.html","/index.html","/"]],
    ["Full Board","./full-board.html",["/full-board.html"]],
    ["Matchup Lab","./matchup-lab.html",["/matchup-lab.html"]],
    ["Platoon Edge","./platoon-edge.html",["/platoon-edge.html"]],
    ["Pitcher Vulnerability","./pitcher-vulnerability.html",["/pitcher-vulnerability.html"]],
    ["Power Zones","./power-zones.html",["/power-zones.html"]],
    ["Weather","./weather.html",["/weather.html"]],
    ["HR Tracker","./live-home-runs.html",["/live-home-runs.html"]],
    ["Near HR Tracker","./live-near-home-runs.html",["/live-near-home-runs.html"]],
    ["Results Archive","./results.html",["/results.html"]],
    ["Decision Center","./hr-decision-center.html",["/hr-decision-center.html","/decision-center.html"]],
    ["AI Says","./ai-says.html",["/ai-says.html"]],
    ["Hall of Fame","./ai-hall-of-fame.html",["/ai-hall-of-fame.html"]]
  ];

  const mlbPrimaryOrder = ["Slate", "Decision Center", "HR Tracker"];
  const wnbaItems = [
    ["Slate","./wnba.html",["/wnba.html"]],
    ["Decision Center","./wnba-decision-center.html",["/wnba-decision-center.html"]],
    ["Results","./wnba-results.html",["/wnba-results.html"]],
    ["AI Says","./wnba-ai-says.html",["/wnba-ai-says.html"]],
    ["How to Use","./how-to-use.html",["/how-to-use.html"]],
    ["Disclaimer","./disclaimer.html",["/disclaimer.html"]]
  ];
  const wnbaPrimaryOrder = ["Slate", "Decision Center", "Results", "AI Says"];
  const nflItems = [
    ["NFL Home","#pageTitle",["/nfl.html"]],
    ["Anytime TD","#anytime-td",[]],
    ["Rec Yds","#receiving-yards",[]],
    ["Rush Yds","#market-rushing-yards",[]],
    ["Pass Yds","#market-passing-yards",[]],
    ["Status","#nfl-status",[]],
    ["My Account","./account.html",["/account.html"]],
    ["Disclaimer","./disclaimer.html",["/disclaimer.html"]]
  ];
  const nflPrimaryOrder = ["NFL Home", "Anytime TD", "Rec Yds", "Rush Yds", "Pass Yds", "Status"];
  const nbaItems = [
    ["NBA Home","./nba.html",["/nba.html"]],
    ["Points","./nba-points.html",["/nba-points.html"]],
    ["Rebounds","./nba-rebounds.html",["/nba-rebounds.html"]],
    ["Assists","./nba-assists.html",["/nba-assists.html"]],
    ["Threes","./nba-threes.html",["/nba-threes.html"]],
    ["Matchups","./nba-matchups.html",["/nba-matchups.html"]],
    ["My Account","./account.html",["/account.html"]],
    ["Disclaimer","./disclaimer.html",["/disclaimer.html"]]
  ];
  const nbaPrimaryOrder = ["NBA Home", "Points", "Rebounds", "Assists", "Threes", "Matchups"];
  const generalItems = [
    ["Home","./index.html",["/index.html","/"]],
    ["MLB","./mlb.html",[]],
    ["WNBA","./wnba.html",[]],
    ["NFL","./nfl.html",[]],
    ["College Football","./cfb.html",["/cfb.html"]],
    ["NBA","./nba.html",[]],
    ["My Account","./account.html",["/account.html"]],
    ["How to Use","./how-to-use.html",["/how-to-use.html"]],
    ["Disclaimer","./disclaimer.html",["/disclaimer.html"]]
  ];
  const generalPrimaryOrder = ["Home", "MLB", "WNBA", "NFL", "College Football", "NBA", "My Account"];
  const generalPaths = new Set(["/", "/index.html", "/account.html", "/disclaimer.html", "/how-to-use.html", "/blog.html", "/blog-hr-shortlist.html", "/blog-pitcher-vulnerability.html", "/blog-signal-stack.html"]);
  const protectedPaths = new Set([
    "/cfb.html",
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
    "/wnba-decision-center.html",
    "/wnba-results.html",
    "/wnba-ai-says.html",
    "/wnba-full-board.html",
    "/wnba-quick-target.html",
    "/nfl.html",
    "/pitcher-vulnerability.html",
    "/platoon-edge.html",
    "/player-intelligence.html",
    "/power-zones.html",
    "/tags.html"
  ]);

  function itemIsActive(activePaths, path){
    return activePaths.includes(path);
  }

  function sectionForPath(path){
    if (path === "/cfb.html") return "general";
    if (path === "/nfl.html") return "nfl";
    if (path === "/wnba.html" || path.startsWith("/wnba-")) return "wnba";
    if (path === "/nba.html" || path.startsWith("/nba-")) return "nba";
    if (generalPaths.has(path)) return "general";
    return "mlb";
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
    const bodySection = document.body?.classList.contains("tsl-nfl-page") ? "nfl" : (document.body?.classList.contains("tsl-wnba-page") ? "wnba" : "");
    const section = bodySection || sectionForPath(path);
    const navItems = section === "nfl" ? nflItems : section === "wnba" ? wnbaItems : section === "nba" ? nbaItems : section === "general" ? generalItems : mlbItems;
    const navPrimaryOrder = section === "nfl" ? nflPrimaryOrder : section === "wnba" ? wnbaPrimaryOrder : section === "nba" ? nbaPrimaryOrder : section === "general" ? generalPrimaryOrder : mlbPrimaryOrder;
    const navPrimaryLabels = new Set(navPrimaryOrder);
    const header = document.createElement("header");
    header.className = `tsl-site-header tsl-${section}-header`;
    document.documentElement.dataset.sport = section;
    document.body?.classList.add(`tsl-${section}-section`);

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
      const viewportWidth = window.visualViewport?.width || window.innerWidth || 1200;
      const top = Math.max(84, Math.round(rect.bottom + 8));
      const maxHeight = Math.max(220, Math.round(viewportHeight - top - 16));
      const right = Math.max(12, Math.round(viewportWidth - rect.right));
      panel.style.setProperty("--tsl-nav-menu-top", `${top}px`);
      panel.style.setProperty("--tsl-nav-menu-max-height", `${maxHeight}px`);
      panel.style.setProperty("--tsl-nav-menu-right", `${right}px`);
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

    const themeButton = document.createElement("button");
    themeButton.type = "button";
    themeButton.className = "tsl-theme-toggle";
    themeButton.dataset.tslThemeToggle = "true";
    themeButton.addEventListener("click", () => {
      const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, theme); } catch {}
      applyTheme(theme);
    });
    nav.appendChild(themeButton);

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
    const section = document.documentElement.dataset.sport || sectionForPath(window.location.pathname);
    const links = section === "nfl"
      ? [["NFL Home","./nfl.html#dashboard"],["Anytime TD","./nfl.html#touchdowns"],["Rec Yds","./nfl.html#receiving"],["Rush Yds","./nfl.html#rushing"],["Pass Yds","./nfl.html#passing"],["Status","./nfl.html#status"]]
      : section === "wnba"
        ? [["WNBA Slate","./wnba.html"],["Decision Center","./wnba-decision-center.html"],["Results","./wnba-results.html"],["AI Says","./wnba-ai-says.html"]]
        : section === "nba"
          ? [["NBA Home","./nba.html"],["Points","./nba-points.html"],["Rebounds","./nba-rebounds.html"],["Matchups","./nba-matchups.html"]]
          : section === "mlb"
            ? [["MLB Slate","./mlb.html"],["Decision Center","./hr-decision-center.html"],["Results","./results.html"],["AI Says","./ai-says.html"]]
            : [["Home","./index.html"],["How to Use","./how-to-use.html"],["Account","./account.html"],["Disclaimer","./disclaimer.html"]];
    const footer = document.createElement("footer");
    footer.className = "tsl-site-footer";
    footer.innerHTML = `
      <div class="tsl-site-footer-inner">
        <a class="tsl-site-footer-brand" href="./index.html">The Slip <span>Lab</span></a>
        <nav class="tsl-site-footer-links" aria-label="Footer navigation">${links.map(([label, href]) => `<a href="${href}">${label}</a>`).join("")}</nav>
      </div>
    `;
    return footer;
  }

  function init(){
    if (document.documentElement.dataset.disableOdds !== "true" && !document.querySelector('script[data-tsl-odds]')) {
      const oddsScript = document.createElement('script');
      oddsScript.type = 'module'; oddsScript.src = './assets/sports-odds.js';
      oddsScript.dataset.tslOdds = 'true'; document.head.appendChild(oddsScript);
    }
    if (document.querySelector(".tsl-site-header")) return;
    hideOldHeaders();
    const header = buildHeader();
    document.body.insertBefore(header, document.body.firstChild);
    applyTheme(document.documentElement.dataset.theme || preferredTheme());
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
