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

  window.fetch = async function authorizedMemberFetch(input, init = {}) {
    const file = dataFile(input);
    if (!file || publicFiles.has(file)) return nativeFetch(input, init);

    const account = await accountClient();
    const token = await account?.accessToken?.().catch(() => "") || "";
    const headers = new Headers(
      init.headers || (input instanceof Request ? input.headers : undefined)
    );
    if (token) headers.set("Authorization", `Bearer ${token}`);

    return nativeFetch(input, { ...init, headers });
  };
})();
