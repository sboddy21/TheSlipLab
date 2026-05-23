(function () {
  const href = "./hr-decision-center.html";

  if (document.querySelector('[data-hr-decision-pill="true"]')) return;

  const style = document.createElement("style");
  style.textContent = `
    .hr-decision-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: #9cff38;
      color: #050505 !important;
      border: 1px solid rgba(156,255,56,.75);
      border-radius: 999px;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 950;
      text-decoration: none !important;
      box-shadow: 0 12px 32px rgba(156,255,56,.18);
      white-space: nowrap;
    }

    .hr-decision-pill:hover {
      transform: translateY(-1px);
      filter: brightness(1.05);
    }

    .hr-decision-pill-wrap {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      margin: 14px 0 18px;
    }
  `;
  document.head.appendChild(style);

  const pill = document.createElement("a");
  pill.href = href;
  pill.className = "hr-decision-pill";
  pill.dataset.hrDecisionPill = "true";
  pill.textContent = "HR Decision Center";

  const nav =
    document.querySelector("nav") ||
    document.querySelector(".topbar") ||
    document.querySelector(".header") ||
    document.querySelector(".site-header");

  if (nav) {
    nav.appendChild(pill);
    return;
  }

  const target =
    document.querySelector("main") ||
    document.querySelector(".app") ||
    document.body;

  const wrap = document.createElement("div");
  wrap.className = "hr-decision-pill-wrap";
  wrap.appendChild(pill);

  target.prepend(wrap);
})();
