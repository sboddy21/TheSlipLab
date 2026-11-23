(function installMemberDataAuthorization() {
  const nativeFetch = window.fetch.bind(window);
  const publicFiles = new Set([
    "health_status.json",
    "hr_calibration_report.json",
    "hr_results_history.json",
    "mlb_ball_carry_index.json",
    "mlb_context_factors.json",
    "mlb_games_today.json",
    "mlb_park_factors.json",
    "mlb_park_shapes.json",
    "mlb_results.json",
    "mlb_results_previous.json",
    "mlb_weather.json"
  ]);

  function dataFile(input) {
    try {
      const value = input instanceof Request ? input.url : String(input || "");
      const url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/data/")) return "";
      return decodeURIComponent(url.pathname.slice("/data/".length));
    } catch {
      return "";
    }
  }

  async function accountClient() {
    if (window.TSLAccount?.ready) {
      await window.TSLAccount.ready;
      return window.TSLAccount;
    }

    await new Promise(resolve => {
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        if (window.TSLAccount?.ready || attempts >= 100) {
          window.clearInterval(timer);
          resolve();
        }
      }, 50);
    });

    if (window.TSLAccount?.ready) await window.TSLAccount.ready;
    return window.TSLAccount || null;
  }

  const feedIssues = new Map();
  function showFeedStatus(input, response) {
    const file = dataFile(input);
    const freshness = response.headers?.get("X-Data-Freshness");
    if (response.status === 503) feedIssues.set(file, "unavailable");
    else if (response.ok && freshness === "delayed") feedIssues.set(file, "delayed");
    else if (response.ok) feedIssues.delete(file);
    let notice = document.getElementById("tslDataUnavailable");
    if (!feedIssues.size) { notice?.remove(); return; }
    if (!notice) {
      notice = document.createElement("aside");
      notice.id = "tslDataUnavailable";
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      notice.style.cssText = "position:fixed;bottom:16px;left:16px;right:16px;z-index:100001;padding:14px 18px;border:2px solid #ffb323;border-radius:12px;background:#191609;color:#fff;font:600 14px/1.5 system-ui;box-shadow:0 4px 24px #0008;max-height:30vh;overflow:auto";
      document.body.appendChild(notice);
    }
    const unavailable = [...feedIssues.values()].includes("unavailable");
    notice.textContent = `${unavailable ? "DATA UNAVAILABLE: Some current feeds could not be verified." : "DELAYED DATA: This page includes older data."} Check the affected feeds before using this board: ${[...feedIssues].map(([name, status]) => `${name.replace(/\.json$/, "").replace(/_/g, " ")} (${status})`).join("; ")}. This notice clears when those feeds recover.`;
  }

  async function fetchCurrentData(input, init) {
    let response;
    try {
      response = await nativeFetch(input, { ...init, cache: "no-store" });
    } catch (error) {
      showFeedStatus(input, { status: 503 });
      throw error;
    }
    if (response.status === 503) {
      await new Promise(resolve => window.setTimeout(resolve, 750));
      try {
        response = await nativeFetch(input, { ...init, cache: "no-store" });
      } catch (error) {
        showFeedStatus(input, { status: 503 });
        throw error;
      }
    }
    showFeedStatus(input, response);
    return response;
  }

  window.fetch = async function authorizedMemberFetch(input, init = {}) {
    const file = dataFile(input);
    if (!file) return nativeFetch(input, init);
    if (publicFiles.has(file)) return fetchCurrentData(input, init);

    const account = await accountClient();
    const token = await account?.accessToken?.().catch(() => "") || "";
    const headers = new Headers(
      init.headers || (input instanceof Request ? input.headers : undefined)
    );
    if (token) headers.set("Authorization", `Bearer ${token}`);

    return fetchCurrentData(input, { ...init, headers });
  };
})();
