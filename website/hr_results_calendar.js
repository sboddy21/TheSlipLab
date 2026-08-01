(function () {
  const DATA_URL = "./data/hr_results_history.json";

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character]));
  }

  function prettyDate(iso, options = {}) {
    const [year, month, day] = String(iso).split("-").map(Number);
    if (!year || !month || !day) return "Unknown date";
    return new Date(year, month - 1, day).toLocaleDateString("en-US", {
      month: options.short ? "short" : "long",
      day: "numeric",
      year: options.short ? undefined : "numeric"
    });
  }

  function playerCard(row) {
    const matchup = [row.team, row.opponent ? `vs ${row.opponent}` : ""].filter(Boolean).join(" ");
    const result = [
      row.distance ? `${row.distance} ft` : "",
      row.exitVelocity ? `${row.exitVelocity} mph EV` : "",
      row.pitchType || ""
    ].filter(Boolean).join(" • ");

    return `
      <article class="hr-results-calendar-player">
        <div>
          <strong>${esc(row.player)}</strong>
          <span>${esc(matchup)}</span>
        </div>
        <em>${esc(result || `${Number(row.hr || 1)} HR`)}</em>
      </article>
    `;
  }

  function mountCalendar(data) {
    const target = document.querySelector("#hr-results-calendar");
    if (!target) return;

    const days = Array.isArray(data.days) ? data.days.filter(day => day?.date) : [];
    const latestDate = days[0]?.date || new Date().toISOString().slice(0, 10);

    target.innerHTML = `
      <div class="section-heading compact hr-results-calendar-heading">
        <div>
          <span>04 / Results archive</span>
          <h2>Review the record.</h2>
        </div>
        <p>Choose a completed slate to inspect its verified home-run outcomes.</p>
      </div>

      <details class="hr-results-calendar-disclosure">
        <summary>
          <span><strong>Browse the 60-day archive</strong><small>Choose any completed date to see its verified home runs.</small></span>
          <em>Open archive</em>
        </summary>
        <div class="hr-results-calendar-card">
        <div class="hr-results-calendar-head">
          <div>
            <div class="hr-results-calendar-kicker">Recent slates</div>
            <h3>60-day home run ledger</h3>
          </div>
          <div class="hr-results-calendar-controls">
            <label for="hrResultsDate">Jump to date</label>
            <input id="hrResultsDate" type="date" value="${esc(latestDate)}">
          </div>
        </div>

        <div class="hr-results-calendar-days" role="list" aria-label="Recent result dates">
          ${days.slice(0, 10).map((day, index) => `
            <button class="hr-results-calendar-day${index === 0 ? " active" : ""}" data-results-date="${esc(day.date)}" type="button">
              <strong>${esc(prettyDate(day.date, { short: true }))}</strong>
              <span>${Number(day.total ?? day.homeRuns?.length ?? 0)} HR</span>
            </button>
          `).join("")}
        </div>

        <div class="hr-results-calendar-list" aria-live="polite"></div>
        </div>
      </details>
    `;

    const input = target.querySelector("#hrResultsDate");
    const list = target.querySelector(".hr-results-calendar-list");
    input.max = new Date().toISOString().slice(0, 10);

    function renderDay(date) {
      const day = days.find(entry => entry.date === date);
      target.querySelectorAll("[data-results-date]").forEach(button => {
        button.classList.toggle("active", button.dataset.resultsDate === date);
      });

      if (!day) {
        list.innerHTML = `
          <div class="hr-results-calendar-selected">
            <strong>${esc(prettyDate(date))}</strong>
            <span>No saved report</span>
          </div>
          <div class="hr-results-empty">No verified home-run results are stored for this date.</div>
        `;
        return;
      }

      const homeRuns = Array.isArray(day.homeRuns) ? day.homeRuns : [];
      list.innerHTML = `
        <div class="hr-results-calendar-selected">
          <strong>${esc(prettyDate(day.date))}</strong>
          <span>${homeRuns.length} verified homer${homeRuns.length === 1 ? "" : "s"}</span>
        </div>
        ${homeRuns.length
          ? `<div class="hr-results-calendar-grid">${homeRuns.map(playerCard).join("")}</div>`
          : `<div class="hr-results-empty">No home runs were recorded for this slate.</div>`}
      `;
    }

    target.addEventListener("click", event => {
      const button = event.target.closest("[data-results-date]");
      if (!button) return;
      input.value = button.dataset.resultsDate;
      renderDay(button.dataset.resultsDate);
    });
    input.addEventListener("change", () => renderDay(input.value));
    renderDay(latestDate);
  }

  fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" })
    .then(response => response.ok ? response.json() : { days: [] })
    .then(mountCalendar)
    .catch(error => console.warn("Results archive unavailable", error));
})();
