(() => {
  const $ = id => document.getElementById(id);
  const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const pct = value => number(value) === null ? "—" : `${Number(value).toFixed(1)}%`;
  const signed = value => {
    const n = number(value);
    if (n === null) return "—";
    return `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
  };
  const field = (row, keys, fallback = "—") => {
    for (const key of keys) if (row?.[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
    return fallback;
  };

  function setState(title, detail, kind = "") {
    const state = $("report-state");
    state.className = `report-state ${kind}`.trim();
    state.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = title;
    const text = document.createElement("span");
    text.textContent = detail;
    state.append(strong, text);
  }

  function metric(metricRow) {
    const hits = number(field(metricRow, ["hits", "homeRuns"], 0)) || 0;
    const total = number(field(metricRow, ["predictions", "players", "count"], 0)) || 0;
    return { hits, total, rate: number(field(metricRow, ["hitRate", "rate", "conversionRate"], total ? hits / total * 100 : 0)) || 0 };
  }

  function renderRows(target, rows, emptyMessage) {
    target.replaceChildren();
    if (!Array.isArray(rows) || !rows.length) {
      const empty = document.createElement("div");
      empty.className = "report-empty";
      empty.textContent = emptyMessage;
      target.append(empty);
      return;
    }
    rows.slice(0, 10).forEach((row, index) => {
      const wrapper = document.createElement("article");
      wrapper.className = "report-row";
      const cells = [
        ["report-rank", `#${field(row, ["rank"], index + 1)}`, ""],
        ["report-player", field(row, ["player", "batter", "name"]), field(row, ["team", "matchup", "opponent"], "Verified player result")],
        ["report-cell", field(row, ["grade", "tier", "label"], "Verified"), "Pregame read"],
        ["report-cell", `${field(row, ["distance"], "—")}${number(row?.distance) !== null ? " ft" : ""}`, "Result distance"],
        ["report-cell", `${field(row, ["confidence", "probability", "hrProbability"], "—")}${number(field(row, ["confidence", "probability", "hrProbability"], null)) !== null ? "%" : ""}`, "Pregame confidence"]
      ];
      cells.forEach(([className, primary, secondary]) => {
        const cell = document.createElement("div");
        cell.className = className;
        const main = document.createElement(className === "report-player" ? "strong" : "b");
        main.textContent = String(primary);
        cell.append(main);
        if (secondary) {
          const small = document.createElement("small");
          small.textContent = secondary;
          cell.append(small);
        }
        wrapper.append(cell);
      });
      target.append(wrapper);
    });
  }

  async function load() {
    try {
      const response = await fetch(`./data/hr_calibration_report.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Report request returned ${response.status}`);
      const data = await response.json();
      const report = data?.dailyReport;
      if (!report || typeof report !== "object") throw new Error("Daily verification block is missing");
      $("report-date-label").textContent = report.reportDate || "Date unavailable";

      if (report.status !== "verified") {
        const reasons = {
          result_slate_not_final: "The archived result slate is not fully final, so no daily claims will be published yet.",
          no_games_scheduled: "No MLB games were scheduled for this report date.",
          no_verified_pregame_receipts: "No qualifying pregame model archive could be matched to the completed results.",
          incomplete_pregame_game_coverage: "The pregame archive does not cover every scheduled game, so a partial report will not be published."
        };
        setState("No verified report is available yet.", reasons[report.reason] || "Required result or pregame verification inputs are incomplete.", "is-error");
        return;
      }

      setState("Verified report published.", `Finalized results for ${report.reportDate} were matched to archived pregame model receipts.`, "is-verified");
      $("verified-report").hidden = false;
      $("actual-home-runs").textContent = field(report, ["actualSlateHomeRuns"]);
      $("expected-home-runs").textContent = number(field(report, ["expectedHomeRuns", "expected"], null)) === null ? "—" : Number(field(report, ["expectedHomeRuns", "expected"])).toFixed(1);
      $("home-run-delta").textContent = signed(field(report, ["actualVsExpected"], null));
      $("pregame-coverage").textContent = pct(field(report, ["gameCoverage"], null));
      const top10 = metric(report.top10);
      const top30 = metric(report.top30);
      const board = metric(report.fullBoard);
      $("top10-hits").textContent = `${top10.hits} HR`;
      $("top10-rate").textContent = `${pct(top10.rate)} conversion / ${top10.total} tracked`;
      $("top30-hits").textContent = `${top30.hits} HR`;
      $("top30-rate").textContent = `${pct(top30.rate)} conversion / ${top30.total} tracked`;
      $("board-hits").textContent = `${board.hits} HR`;
      $("board-rate").textContent = `${pct(board.rate)} conversion / ${board.total} tracked`;
      renderRows($("verified-calls"), report.verifiedCalls, "No verified model hits were recorded for this report.");
      renderRows($("notable-misses"), report.notableMisses, "No notable misses crossed the published reporting threshold.");
    } catch (error) {
      setState("The report could not be verified.", error.message, "is-error");
    }
  }
  load();
})();
