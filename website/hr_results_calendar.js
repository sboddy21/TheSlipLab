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
      day: "numeric"
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
    const recent = days.slice(0, 14);

    const wrap = document.createElement("section");
    wrap.className = "hr-results-calendar-card";
    wrap.innerHTML = `
      <div class="hr-results-calendar-head">
        <div>
          <div class="hr-results-calendar-kicker">HR Results Calendar</div>
          <h2>Previous Home Run Hitters</h2>
        </div>
        <div class="hr-results-calendar-updated">
          ${data.updatedAt ? "Updated " + esc(new Date(data.updatedAt).toLocaleString()) : ""}
        </div>
      </div>

      <div class="hr-results-calendar-days">
        ${recent.map((day, i) => `
          <button class="hr-results-calendar-day ${i === 0 ? "active" : ""}" data-date="${esc(day.date)}">
            <strong>${esc(prettyDate(day.date))}</strong>
            <span>${Number(day.total || 0)} HR</span>
          </button>
        `).join("")}
      </div>

      <div class="hr-results-calendar-list"></div>
    `;

    target.prepend(wrap);

    const list = wrap.querySelector(".hr-results-calendar-list");
    const buttons = Array.from(wrap.querySelectorAll(".hr-results-calendar-day"));

    function renderDay(date) {
      const day = days.find(d => d.date === date) || days[0];
      if (!day) {
        list.innerHTML = `<div class="hr-results-empty">No HR history saved yet.</div>`;
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

    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        buttons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderDay(btn.dataset.date);
      });
    });

    renderDay(recent[0]?.date);
  }

  fetch(DATA_URL, { cache: "no-store" })
    .then(r => r.ok ? r.json() : { days: [] })
    .then(mountCalendar)
    .catch(() => {});
})();
