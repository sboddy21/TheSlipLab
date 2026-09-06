(() => {
  const storageKey = "tsl:football-live:seen:v2";
  const rootId = "tsl-nfl-launch";

  if (document.getElementById(rootId) || window.__tslNflLaunchShown) return;

  try {
    if (sessionStorage.getItem(storageKey)) return;
    sessionStorage.setItem(storageKey, "1");
  } catch (_) {
    window.__tslNflLaunchShown = true;
  }

  const show = () => {
    if (!document.body || document.getElementById(rootId)) return;

    const style = document.createElement("style");
    style.id = `${rootId}-styles`;
    style.textContent = `
      #${rootId}{--nfl-night:#04101f;--nfl-blue:#1877ff;--nfl-cyan:#41dcff;--nfl-orange:#ff5b35;position:fixed;z-index:2147483000;inset:0;display:grid;place-items:center;padding:20px;background:rgba(1,8,18,.78);backdrop-filter:blur(14px);opacity:0;visibility:hidden;transition:opacity .35s ease,visibility .35s ease}
      #${rootId}.is-open{opacity:1;visibility:visible}
      #${rootId} *{box-sizing:border-box}
      #${rootId} .nfl-launch-card{position:relative;width:min(940px,100%);min-height:490px;overflow:hidden;display:grid;grid-template-columns:minmax(0,.92fr) minmax(360px,1.08fr);border:1px solid rgba(93,202,255,.52);border-radius:28px;background:var(--nfl-night);color:#fff;box-shadow:0 34px 100px rgba(0,0,0,.62),0 0 70px rgba(24,119,255,.24),inset 0 1px rgba(255,255,255,.12);transform:translateY(20px) scale(.97);transition:transform .48s cubic-bezier(.2,.8,.2,1)}
      #${rootId}.is-open .nfl-launch-card{transform:translateY(0) scale(1)}
      #${rootId} .nfl-launch-card:before{content:"";position:absolute;z-index:2;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(120deg,rgba(255,255,255,.12),transparent 25%,transparent 70%,rgba(65,220,255,.08))}
      #${rootId} .nfl-launch-copy{position:relative;z-index:3;display:flex;flex-direction:column;justify-content:center;padding:48px 12px 44px 48px;background:radial-gradient(circle at 15% 15%,rgba(24,119,255,.22),transparent 35%),linear-gradient(90deg,#04101f 82%,transparent)}
      #${rootId} .nfl-launch-kicker{display:flex;align-items:center;gap:9px;width:max-content;margin-bottom:18px;padding:7px 10px;border:1px solid rgba(65,220,255,.34);border-radius:999px;background:rgba(7,32,60,.8);color:#b9efff;font:900 9px/1 Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase}
      #${rootId} .nfl-launch-kicker:before{content:"";width:7px;height:7px;border-radius:50%;background:#baff4a;box-shadow:0 0 14px #baff4a;animation:nflPulse 1.7s ease-in-out infinite}
      #${rootId} h2{margin:0;max-width:450px;color:#fff;font:950 clamp(44px,6vw,76px)/.87 Impact,"Arial Black",Arial,sans-serif;letter-spacing:-.045em;text-transform:uppercase;text-shadow:0 7px 32px rgba(0,0,0,.52)}
      #${rootId} h2 span{display:block;color:transparent;background:linear-gradient(90deg,var(--nfl-cyan),#71a8ff 55%,#fff);background-clip:text;-webkit-background-clip:text;filter:drop-shadow(0 0 18px rgba(65,220,255,.3))}
      #${rootId} p{max-width:440px;margin:20px 0 0;color:#bfd0e0;font:500 14px/1.6 Inter,Arial,sans-serif}
      #${rootId} .nfl-launch-pills{display:flex;flex-wrap:wrap;gap:7px;margin-top:22px}
      #${rootId} .nfl-launch-pills span{padding:7px 9px;border:1px solid rgba(255,255,255,.15);border-radius:999px;background:rgba(255,255,255,.06);color:#eaf5ff;font:900 8px/1 Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase}
      #${rootId} .nfl-launch-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px}
      #${rootId} .nfl-launch-action{min-height:44px;display:inline-flex;align-items:center;justify-content:center;padding:0 18px;border:1px solid rgba(255,255,255,.3);border-radius:999px;background:transparent;color:#fff;cursor:pointer;text-decoration:none;font:950 10px/1 Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;transition:transform .2s ease,box-shadow .2s ease,background .2s ease}
      #${rootId} .nfl-launch-action:hover{transform:translateY(-2px)}
      #${rootId} .nfl-launch-action.primary{border-color:var(--nfl-orange);background:linear-gradient(135deg,var(--nfl-orange),#ff7a38);box-shadow:0 10px 28px rgba(255,91,53,.28)}
      #${rootId} .nfl-launch-visual{position:relative;min-height:490px;background:#061323 url("/assets/nfl-coming-soon.webp") 57% center/cover no-repeat}
      #${rootId} .nfl-launch-visual:before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,#04101f 0,transparent 42%),linear-gradient(0deg,rgba(4,16,31,.36),transparent 45%)}
      #${rootId} .nfl-launch-season{position:absolute;z-index:3;right:22px;bottom:22px;padding:9px 12px;border:1px solid rgba(65,220,255,.5);border-radius:999px;background:rgba(3,18,36,.76);color:#e9f9ff;font:950 9px/1 Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;backdrop-filter:blur(10px);box-shadow:0 0 24px rgba(65,220,255,.18)}
      #${rootId} .nfl-launch-close{position:absolute;z-index:5;top:16px;right:16px;width:38px;height:38px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.28);border-radius:50%;background:rgba(3,15,29,.72);color:#fff;cursor:pointer;font:400 22px/1 Arial,sans-serif;backdrop-filter:blur(9px);transition:transform .2s ease,background .2s ease}
      #${rootId} .nfl-launch-close:hover{transform:rotate(8deg) scale(1.06);background:var(--nfl-orange)}
      body.tsl-nfl-launch-lock{overflow:hidden!important}
      @keyframes nflPulse{50%{opacity:.5;transform:scale(.72)}}
      @media(max-width:760px){#${rootId}{padding:12px}#${rootId} .nfl-launch-card{min-height:0;grid-template-columns:1fr;border-radius:22px}#${rootId} .nfl-launch-copy{padding:38px 24px 28px;background:linear-gradient(180deg,rgba(4,16,31,.75),#04101f),url("/assets/nfl-coming-soon.webp") 63% 25%/cover no-repeat}#${rootId} .nfl-launch-visual{display:none}#${rootId} h2{font-size:clamp(45px,15vw,66px)}#${rootId} p{font-size:13px}#${rootId} .nfl-launch-close{top:12px;right:12px}}
      @media(prefers-reduced-motion:reduce){#${rootId},#${rootId} .nfl-launch-card,#${rootId} .nfl-launch-action,#${rootId} .nfl-launch-close{transition:none}#${rootId} .nfl-launch-kicker:before{animation:none}}
    `;

    const root = document.createElement("div");
    root.id = rootId;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", `${rootId}-title`);
    root.innerHTML = `
      <section class="nfl-launch-card">
        <button class="nfl-launch-close" type="button" aria-label="Close football launch announcement">×</button>
        <div class="nfl-launch-copy">
          <div class="nfl-launch-kicker">Football is live in The Lab</div>
          <h2 id="${rootId}-title">NFL + NCAAF <span>Live Now</span></h2>
          <p>Pro and college football now have dedicated live labs for weekly matchups, player roles, usage, availability, and game context.</p>
          <div class="nfl-launch-pills" aria-label="Live football coverage"><span>NFL player intelligence</span><span>NCAAF weekly slate</span><span>Live matchup context</span></div>
          <div class="nfl-launch-actions"><a class="nfl-launch-action primary" href="./nfl.html">Open NFL</a><a class="nfl-launch-action" href="./cfb.html">Open NCAAF</a><button class="nfl-launch-action" type="button" data-nfl-dismiss>Keep exploring</button></div>
        </div>
        <div class="nfl-launch-visual" aria-hidden="true"><span class="nfl-launch-season">NFL + NCAAF are live</span></div>
      </section>`;

    const handleKeydown = (event) => {
      if (event.key === "Escape" && root.isConnected) close();
    };

    const close = () => {
      root.classList.remove("is-open");
      document.body.classList.remove("tsl-nfl-launch-lock");
      document.removeEventListener("keydown", handleKeydown);
      window.setTimeout(() => {
        root.remove();
        style.remove();
      }, 380);
    };

    root.querySelector(".nfl-launch-close").addEventListener("click", close);
    root.querySelector("[data-nfl-dismiss]").addEventListener("click", close);
    root.addEventListener("click", (event) => {
      if (event.target === root) close();
    });
    document.addEventListener("keydown", handleKeydown);

    document.head.appendChild(style);
    document.body.appendChild(root);
    document.body.classList.add("tsl-nfl-launch-lock");
    window.requestAnimationFrame(() => {
      root.classList.add("is-open");
      root.querySelector(".nfl-launch-close").focus({ preventScroll: true });
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.setTimeout(show, 650), { once: true });
  } else {
    window.setTimeout(show, 650);
  }
})();
