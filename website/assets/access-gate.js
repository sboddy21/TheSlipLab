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
    "/live-extra-bases.html",
    "/live-hard-hit.html",
    "/live-heatmap.html",
    "/live-home-runs.html",
    "/live-near-home-runs.html",
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
    "/nfl-touchdown-ai.html",
    "/pitcher-vulnerability.html",
    "/player-intelligence.html",
    "/power-zones.html",
    "/platoon-edge.html",
    "/quick-target.html",
    "/results.html",
    "/streak-lab.html",
    "/weather.html",
    "/tags.html"
  ]);

  const openPaths = new Set([
    "/",
    "/index.html",
    "/account.html",
    "/blog.html",
    "/blog-hr-shortlist.html",
    "/blog-pitcher-vulnerability.html",
    "/blog-signal-stack.html",
    "/how-to-use.html"
  ]);

  function normalizedPath(){
    const path = window.location.pathname || "/";
    if (path === "/decision-center.html") return "/hr-decision-center.html";
    return path;
  }

  function isProtected(){
    const path = normalizedPath();
    const sportPrefix = /^\/(?:wnba|nfl|nba|nhl|cfb|ncaaf)(?:-|\.|\/)/.test(path);
    return (protectedPaths.has(path) || sportPrefix) && !openPaths.has(path);
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

  function updateGateCard({ eyebrow = "Member access", title = "Checking your Slip Lab login…", body = "The daily slate and model tools require a Slip Lab account while paid member access is being prepared.", action = "" } = {}){
    const gate = document.querySelector(".tsl-access-gate");
    if (!gate) return;
    gate.innerHTML = `
      <div class="tsl-access-card">
        <span>${eyebrow}</span>
        <h1>${title}</h1>
        <p>${body}</p>
        ${action}
      </div>`;
  }

  function checkoutActions() {
    return `
      <div class="tsl-access-plan-grid" aria-label="Choose a membership plan">
        <button class="tsl-access-button" type="button" data-tsl-checkout="weekly">Weekly</button>
        <button class="tsl-access-button" type="button" data-tsl-checkout="monthly">Monthly</button>
        <button class="tsl-access-button" type="button" data-tsl-checkout="annual">Annual</button>
      </div>
      <a class="tsl-access-link" href="./account.html">Back to my account</a>`;
  }

  function unlockPage(){
    document.body.classList.remove("tsl-access-checking");
    document.querySelector(".tsl-access-gate")?.remove();
    window.dispatchEvent(new CustomEvent("tsl-access-granted"));
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

    if (!window.TSLAccount?.session?.user) {
      window.location.replace(accountUrl());
      return;
    }

    try {
      updateGateCard({
        eyebrow: "Member access",
        title: "Checking your subscription…",
        body: "One quick entitlement check, then the board opens."
      });
      const status = await window.TSLAccount.subscriptionStatus();
      if (!status.required || status.active) {
        unlockPage();
        return;
      }
      updateGateCard({
        eyebrow: "Premium access",
        title: "Subscribe to unlock this board.",
        body: "All Slip Lab sport pages, AI boards, matchup tools, trackers, and results are reserved for active members.",
        action: checkoutActions()
      });
    } catch (error) {
      updateGateCard({
        eyebrow: "Access check",
        title: "We could not verify access.",
        body: error.message || "Please refresh or sign in again.",
        action: `<a class="tsl-access-button" href="./account.html">Open account</a>`
      });
    }
  }

  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-tsl-checkout]");
    if (!button) return;
    const plan = button.dataset.tslCheckout || "monthly";
    button.disabled = true;
    button.textContent = "Opening checkout…";
    try {
      const session = await window.TSLAccount.createCheckoutSession(plan);
      window.location.href = session.url;
    } catch (error) {
      button.disabled = false;
      button.textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
      updateGateCard({
        eyebrow: "Checkout unavailable",
        title: "Membership checkout is not ready yet.",
        body: error.message || "Stripe checkout is still being configured.",
        action: checkoutActions()
      });
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enforce);
  else enforce();
})();
