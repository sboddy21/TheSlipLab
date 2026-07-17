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

    items.forEach(([label, href, activePaths]) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      if (href === "./account.html") {
        a.dataset.tslAccountLink = "true";
        a.classList.add("tsl-account-link");
      }
      if (activePaths.includes(path)) a.classList.add("active");
      nav.appendChild(a);
    });

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
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
