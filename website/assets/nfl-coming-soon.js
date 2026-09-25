(() => {
  const storageKey = "tsl:grip-wipes-sponsor:last-shown:v1";
  const rootId = "tsl-grip-wipes-sponsor";
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  if (document.getElementById(rootId) || window.__tslGripWipesShown) return;
  if (window.location.pathname.endsWith("/sponsor.html")) return;

  try {
    const lastShown = Number(localStorage.getItem(storageKey) || 0);
    if (lastShown && Date.now() - lastShown < sevenDays) return;
  } catch (_) {}

  const show = () => {
    if (!document.body || document.getElementById(rootId)) return;
    window.__tslGripWipesShown = true;
    try { localStorage.setItem(storageKey, String(Date.now())); } catch (_) {}

    const style = document.createElement("style");
    style.id = `${rootId}-styles`;
    style.textContent = `
      #${rootId}{--gw-black:#050806;--gw-green:#b7ff16;position:fixed;z-index:2147483000;inset:0;display:grid;place-items:end center;padding:20px;background:rgba(1,7,4,.66);backdrop-filter:blur(8px);opacity:0;visibility:hidden;transition:opacity .28s ease,visibility .28s ease}
      #${rootId}.is-open{opacity:1;visibility:visible}#${rootId} *{box-sizing:border-box}
      #${rootId} .gw-card{position:relative;width:min(760px,100%);min-height:330px;overflow:hidden;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(230px,.85fr);border:1px solid rgba(183,255,22,.5);border-radius:22px;background:radial-gradient(circle at 12% 0,rgba(125,232,0,.14),transparent 38%),#071009;color:#fff;box-shadow:0 28px 80px rgba(0,0,0,.58),0 0 52px rgba(125,232,0,.13);transform:translateY(24px);transition:transform .36s cubic-bezier(.2,.8,.2,1)}
      #${rootId}.is-open .gw-card{transform:translateY(0)}
      #${rootId} .gw-copy{position:relative;z-index:2;display:flex;flex-direction:column;justify-content:center;padding:38px 20px 34px 38px}
      #${rootId} .gw-kicker{display:flex;align-items:center;gap:9px;width:max-content;margin-bottom:14px;color:var(--gw-green);font:950 10px/1 Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase}
      #${rootId} .gw-kicker:before{content:"";width:24px;height:2px;background:var(--gw-green)}
      #${rootId} h2{margin:0;max-width:430px;color:#fff;font:950 clamp(37px,5vw,58px)/.9 Impact,"Arial Black",Arial,sans-serif;letter-spacing:-.035em;text-transform:uppercase}
      #${rootId} h2 span{display:block;color:var(--gw-green)}
      #${rootId} p{max-width:430px;margin:15px 0 0;color:#c2cec5;font:500 14px/1.55 Inter,Arial,sans-serif}
      #${rootId} .gw-points{display:flex;flex-wrap:wrap;gap:7px;margin-top:17px}#${rootId} .gw-points span{padding:6px 9px;border:1px solid rgba(183,255,22,.25);border-radius:999px;color:#eaffc2;font:900 9px/1 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase}
      #${rootId} .gw-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:22px}#${rootId} .gw-action{min-height:42px;display:inline-flex;align-items:center;justify-content:center;padding:0 16px;border:1px solid rgba(255,255,255,.24);border-radius:999px;background:transparent;color:#fff;cursor:pointer;text-decoration:none;font:950 10px/1 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;transition:transform .2s ease,background .2s ease,color .2s ease}#${rootId} .gw-action:hover{transform:translateY(-2px)}#${rootId} .gw-action.primary{border-color:var(--gw-green);background:var(--gw-green);color:var(--gw-black)}
      #${rootId} .gw-visual{position:relative;min-height:330px;display:grid;place-items:center;background:radial-gradient(circle,rgba(183,255,22,.17),transparent 59%),linear-gradient(145deg,#101c11,#030604)}#${rootId} .gw-visual img{width:min(72%,185px);height:auto;max-height:280px;object-fit:cover;object-position:center;border:1px solid rgba(183,255,22,.36);border-radius:15px;box-shadow:0 22px 42px rgba(0,0,0,.45);transform:rotate(3deg)}
      #${rootId} .gw-close{position:absolute;z-index:5;top:13px;right:13px;width:36px;height:36px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.28);border-radius:50%;background:rgba(3,10,5,.78);color:#fff;cursor:pointer;font:400 21px/1 Arial,sans-serif;transition:transform .2s ease,background .2s ease,color .2s ease}#${rootId} .gw-close:hover{transform:rotate(8deg);background:var(--gw-green);color:var(--gw-black)}body.tsl-grip-wipes-lock{overflow:hidden!important}
      @media(max-width:680px){#${rootId}{place-items:end center;padding:10px}#${rootId} .gw-card{min-height:0;grid-template-columns:1fr;border-radius:18px}#${rootId} .gw-copy{padding:31px 24px 25px}#${rootId} .gw-visual{display:none}#${rootId} h2{font-size:clamp(38px,13vw,54px)}#${rootId} p{font-size:13px}#${rootId} .gw-close{top:10px;right:10px}}
      @media(prefers-reduced-motion:reduce){#${rootId},#${rootId} .gw-card,#${rootId} .gw-action,#${rootId} .gw-close{transition:none}}
    `;

    const root = document.createElement("div");
    root.id = rootId;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", `${rootId}-title`);
    root.innerHTML = `<section class="gw-card"><button class="gw-close" type="button" aria-label="Close Grip Wipes sponsor message">×</button><div class="gw-copy"><div class="gw-kicker">Featured sponsor</div><h2 id="${rootId}-title">Your grips suck. <span>Fix them.</span></h2><p>Grip Wipes deep-clean golf grips, restore tack, and dry fast—without sprays, towels, or a mess.</p><div class="gw-points" aria-label="Grip Wipes benefits"><span>Deep clean</span><span>Restore tack</span><span>Bag ready</span></div><div class="gw-actions"><a class="gw-action primary" href="./sponsor.html">Meet Grip Wipes</a><a class="gw-action" href="https://www.instagram.com/gripwipes/" target="_blank" rel="noopener sponsored">DM “GRIP” to order</a></div></div><div class="gw-visual" aria-hidden="true"><img src="./assets/grip-wipes-product.png" alt=""></div></section>`;

    const handleKeydown = event => { if (event.key === "Escape" && root.isConnected) close(); };
    const close = () => {
      root.classList.remove("is-open");
      document.body.classList.remove("tsl-grip-wipes-lock");
      document.removeEventListener("keydown", handleKeydown);
      window.setTimeout(() => { root.remove(); style.remove(); }, 300);
    };

    root.querySelector(".gw-close").addEventListener("click", close);
    root.addEventListener("click", event => { if (event.target === root) close(); });
    document.addEventListener("keydown", handleKeydown);
    document.head.appendChild(style);
    document.body.appendChild(root);
    document.body.classList.add("tsl-grip-wipes-lock");
    window.requestAnimationFrame(() => {
      root.classList.add("is-open");
      root.querySelector(".gw-close").focus({ preventScroll: true });
    });
  };

  window.setTimeout(show, 9000);
})();
