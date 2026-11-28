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

  async function fetchCurrentData(input, init) {
    const response = await nativeFetch(input, { ...init, cache: "no-store" });
    if (response.status === 503) {
      const detail = await response.clone().json().catch(() => null);
      if (detail?.error === "current_data_unavailable") {
        const show = () => {
          let notice = document.getElementById("tslDataUnavailable");
          if (!notice) {
            notice = document.createElement("div");
            notice.id = "tslDataUnavailable";
            notice.setAttribute("role", "alert");
            notice.style.cssText = "padding:14px 20px;background:#35250c;color:#ffe2a6;border-bottom:1px solid #966d28;font:600 14px/1.5 system-ui;position:relative;z-index:100001";
            document.body.prepend(notice);
          }
          notice.textContent = "Current data is unavailable for this view. The latest feed could not be verified. Please try again shortly.";
        };
        if (document.body) show();
        else document.addEventListener("DOMContentLoaded", show, { once: true });
      }
    }
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
