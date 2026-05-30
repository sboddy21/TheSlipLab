(function () {
  const DATA_URL = "./data/hr_results_history.json";

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  function prettyDate(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function mountCalendar(data) {
    const target =
      document.querySelector("#hr-results-calendar") ||
      document.querySelector(".results-calendar") ||
      document.querySelector("main") ||
      document.body;

    if (!target) return;

    const days = Array.isArray(data.days) ? data.days : [];
    const dates = days.map(d => d.date).filter(Boolean);
    const latestDate = dates[0] || new Date().toISOString().slice(0, 10);

    const wrap = document.createElement("section");
    wrap.className = "hr-results-calendar-card";
    wrap.innerHTML = `
      <div class="hr-results-calendar-head">
        <div>
          <div class="hr-results-calendar-kicker">HR Results Calendar</div>
          <h2>Previous Home Run Hitters</h2>
        </div>

        <div class="hr-results-calendar-controls">
          <label for="hrResultsDate">Select date</label>
          <input id="hrResultsDate" type="date" value="${esc(latestDate)}">
        </div>
      </div>

      <div class="hr-results-calendar-list"></div>
    `;

    target.prepend(wrap);

    const input = wrap.querySelector("#hrResultsDate");
    const list = wrap.querySelector(".hr-results-calendar-list");

    input.max = new Date().toISOString().slice(0, 10);
    input.removeAttribute("min");

    function renderDay(date) {
      const day = days.find(d => d.date === date);

      if (!day) {
        list.innerHTML = `
          <div class="hr-results-calendar-selected">
            <strong>${esc(prettyDate(date))}</strong>
            <span>0 hitters</span>
          </div>
          <div class="hr-results-empty">No saved HR results for this date yet.</div>
        `;
        return;
      }

      const hrs = Array.isArray(day.homeRuns) ? day.homeRuns : [];

      list.innerHTML = `
        <div class="hr-results-calendar-selected">
          <strong>${esc(prettyDate(day.date))}</strong>
          <span>${hrs.length} hitter${hrs.length === 1 ? "" : "s"}</span>
        </div>

        ${hrs.length ? `
          <div class="hr-results-calendar-grid">
            ${hrs.map(r => `
              <article class="hr-results-calendar-player">
                <strong>${esc(r.player)}</strong>
                <span>${esc(r.team || "")}${r.opponent ? " vs " + esc(r.opponent) : ""}</span>
                <em>${Number(r.hr || 1)} HR</em>
              </article>
            `).join("")}
          </div>
        ` : `
          <div class="hr-results-empty">No home run hitters saved for this date yet.</div>
        `}
      `;
    }

    input.addEventListener("change", () => renderDay(input.value));
    renderDay(latestDate);
  }

  fetch(DATA_URL, { cache: "no-store" })
    .then(r => r.ok ? r.json() : { days: [] })
    .then(mountCalendar)
    .catch(() => {});
})();
