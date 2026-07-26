(function(){
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

  const openPaths = new Set([
    "/",
    "/index.html",
    "/account.html",
    "/blog.html",
    "/blog-hr-shortlist.html",
    "/blog-pitcher-vulnerability.html",
    "/blog-signal-stack.html",
    "/how-to-use.html",
    "/results.html",
    "/weather.html"
  ]);

  function normalizedPath(){
    const path = window.location.pathname || "/";
    if (path === "/decision-center.html") return "/hr-decision-center.html";
    return path;
  }

  function isProtected(){
    const path = normalizedPath();
    return protectedPaths.has(path) && !openPaths.has(path);
  }

  function accountUrl(){
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return `./account.html?redirect=${encodeURIComponent(returnTo)}`;
  }

  function showGateShell(){
    document.body.classList.add("tsl-access-checking");
    if (document.querySelector(".tsl-access-gate")) return;

    const gate = document.createElement("div");
    gate.className = "tsl-access-gate";
    gate.setAttribute("role", "status");
    gate.setAttribute("aria-live", "polite");
    gate.innerHTML = `
      <div class="tsl-access-card">
        <span>Member access</span>
        <h1>Checking your Slip Lab login…</h1>
        <p>The daily slate and model tools require a Slip Lab account while paid member access is being prepared.</p>
      </div>`;
    document.body.appendChild(gate);
  }

  function waitForAccountClient(){
    if (window.TSLAccount?.ready) return window.TSLAccount.ready;
    return new Promise(resolve => {
      const done = () => resolve();
      window.addEventListener("tsl-account-ready", done, { once: true });
      window.addEventListener("tsl-account-error", done, { once: true });
      setTimeout(done, 5000);
    });
  }

  async function enforce(){
    if (!isProtected()) return;
    showGateShell();
    await waitForAccountClient();

    if (window.TSLAccount?.session?.user) {
      document.body.classList.remove("tsl-access-checking");
      document.querySelector(".tsl-access-gate")?.remove();
      window.dispatchEvent(new CustomEvent("tsl-access-granted"));
      return;
    }

    window.location.replace(accountUrl());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enforce);
  else enforce();
})();
