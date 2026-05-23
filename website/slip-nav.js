(function () {
  if (document.getElementById("slip-live-nav")) return;

  const nav = document.createElement("div");
  nav.id = "slip-live-nav";

  nav.innerHTML = `
    <a href="./index.html">Home</a>
    <a href="./command-center.html">Command</a>
    <a href="./live-game-center.html">Games</a>
    <a href="./live-heatmap.html">Heatmap</a>
    <a href="./bullpen-collapse.html">Bullpen</a>
    <a href="./player-intelligence.html">Players</a>
  `;

  const style = document.createElement("style");
  style.innerHTML = `
    #slip-live-nav {
      position: fixed;
      left: 50%;
      bottom: 16px;
      transform: translateX(-50%);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: rgba(5,5,5,.94);
      border: 1px solid #242424;
      border-radius: 999px;
      padding: 9px 10px;
      backdrop-filter: blur(14px);
      box-shadow: 0 0 28px rgba(0,0,0,.55);
      width: auto;
      max-width: calc(100vw - 28px);
    }

    #slip-live-nav a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      color: white;
      text-decoration: none;
      font-family: Inter, Arial, sans-serif;
      font-size: 12px;
      font-weight: 800;
      line-height: 1;
      background: #101010;
      border: 1px solid #2a2a2a;
      border-radius: 999px;
      padding: 0 13px;
      white-space: nowrap;
    }

    #slip-live-nav a:hover {
      border-color: #30d158;
      color: #30d158;
    }

    body {
      padding-bottom: 86px !important;
    }

    @media (max-width: 768px) {
      #slip-live-nav {
        left: 10px;
        right: 10px;
        bottom: 10px;
        transform: none;
        justify-content: flex-start;
        overflow-x: auto;
        border-radius: 18px;
        padding: 8px;
      }

      #slip-live-nav a {
        min-height: 32px;
        font-size: 11px;
        padding: 0 11px;
      }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(nav);
})();
