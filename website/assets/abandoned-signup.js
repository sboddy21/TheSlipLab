(function () {
  const started = Number(localStorage.getItem("tsl_checkout_started"));
  if (!started || Date.now() - started < 30 * 60 * 1000) return;
  if (sessionStorage.getItem("tsl_abandon_prompt_dismissed") === "true") return;

  const prompt = document.createElement("aside");
  prompt.className = "tsl-abandon-prompt";
  prompt.setAttribute("aria-label", "Finish signing up");
  prompt.innerHTML = `
    <button class="tsl-abandon-close" type="button" aria-label="Dismiss">×</button>
    <span>You left something behind 👀</span>
    <strong>Your Slip Lab access is one step away.</strong>
    <a href="./account.html">Finish signing up</a>
  `;

  const style = document.createElement("style");
  style.textContent = `
    .tsl-abandon-prompt{position:fixed;right:18px;bottom:18px;z-index:100000;width:min(380px,calc(100vw - 36px));padding:22px;border:2px solid #071d36;background:#fffdf7;color:#071d36;box-shadow:8px 8px 0 #0867f2;font-family:Arial,Helvetica,sans-serif}
    .tsl-abandon-close{position:absolute;right:8px;top:6px;border:0;background:none;color:#071d36;font-size:24px;cursor:pointer}
    .tsl-abandon-close+span{display:block;color:#d84320;font-size:10px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}
    .tsl-abandon-close~strong{display:block;margin:9px 24px 16px 0;font-size:21px;line-height:1.08}
    .tsl-abandon-close~a{display:inline-block;padding:12px 15px;background:#d84320;color:#fff;text-decoration:none;font-size:11px;font-weight:950;letter-spacing:.08em;text-transform:uppercase}
  `;
  document.head.appendChild(style);
  document.body.appendChild(prompt);
  prompt.querySelector("button").addEventListener("click", () => {
    sessionStorage.setItem("tsl_abandon_prompt_dismissed", "true");
    prompt.remove();
  });
})();
