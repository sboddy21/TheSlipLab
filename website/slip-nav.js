(function () {
  if (document.getElementById("slip-live-nav")) return;

  const nav = document.createElement("div");
  nav.id = "slip-live-nav";

  nav.innerHTML = `
    <a href="./index.html">Home</a>
    <a href="./command-center.html">Command Center</a>
    <a href="./live-game-center.html">Live Games</a>
    <a href="./live-heatmap.html">Heatmap</a>
    <a href="./bullpen-collapse.html">Bullpen</a>
    <a href="./player-intelligence.html">Players</a>
  `;

  const style = document.createElement("style");
  style.innerHTML = `
    #slip-live-nav {
      position: fixed;
      left: 50%;
      bottom: 18px;
      transform: translateX(-50%);
      z-index: 999999;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: center;
      background: rgba(5,5,5,.92);
      border: 1px solid #252525;
      border-radius: 999px;
      padding: 10px 12px;
      backdrop-filter: blur(12px);
      box-shadow: 0 0 24px rgba(0,0,0,.5);
    }

    #slip-live-nav a {
      color: white;
      text-decoration: none;
      font-family: Inter, Arial, sans-serif;
      font-size: 12px;
      font-weight: 800;
      background: #101010;
      border: 1px solid #2a2a2a;
      border-radius: 999px;
      padding: 8px 11px;
      white-space: nowrap;
    }

    #slip-live-nav a:hover {
      border-color: #30d158;
      color: #30d158;
    }

    @media (max-width: 768px) {
      #slip-live-nav {
        left: 10px;
        right: 10px;
        bottom: 10px;
        transform: none;
        border-radius: 18px;
      }

      #slip-live-nav a {
        font-size: 11px;
        padding: 7px 9px;
      }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(nav);
})();
