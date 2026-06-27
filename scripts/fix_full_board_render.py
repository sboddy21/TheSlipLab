from pathlib import Path
import re

p = Path("website/full-board.html")
text = p.read_text()

fallback = r'''
<script>
(function(){
  const DATA_URLS = [
    "./data/hr_decision_center.json",
    "/data/hr_decision_center.json"
  ];

  const pick = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const txt = v => (v === undefined || v === null || v === "") ? "—" : String(v);

  function collectPlayers(data){
    if (Array.isArray(data?.allPlayers)) return data.allPlayers;
    if (data?.sections && typeof data.sections === "object") {
      const seen = new Set();
      const out = [];
      Object.values(data.sections).forEach(section => {
        const arr = Array.isArray(section) ? section : Array.isArray(section?.players) ? section.players : [];
        arr.forEach(player => {
          const key = player.playerId || player.id || player.name || player.player || JSON.stringify(player).slice(0,80);
          if (!seen.has(key)) {
            seen.add(key);
            out.push(player);
          }
        });
      });
      return out;
    }
    if (Array.isArray(data?.players)) return data.players;
    return [];
  }

  function scoreOf(p){
    return Math.max(
      pick(p.aiScore),
      pick(p.score),
      pick(p.hrScore),
      pick(p.confidenceScore),
      pick(p.finalScore),
      pick(p.modelScore)
    );
  }

  function rowHtml(p, i){
    const name = txt(p.name || p.player || p.playerName);
    const team = txt(p.team || p.playerTeam || p.abbr);
    const opponent = txt(p.opponent || p.opp || p.matchup || p.game);
    const tier = txt(p.tier || p.grade || p.aiTier || p.confidenceTier);
    const board = txt(p.section || p.board || p.aiDailySection || p.category);
    const power = Math.round(Math.max(pick(p.powerScore), pick(p.power), pick(p.hrPower), pick(p.barrelScore)));
    const pitch = Math.round(Math.max(pick(p.pitchEdge), pick(p.pitchScore), pick(p.pitchTypeEdge)));
    const risk = Math.round(Math.max(pick(p.pitcherRisk), pick(p.pitcherScore), pick(p.vulnerabilityScore)));
    const weather = Math.round(Math.max(pick(p.weatherScore), pick(p.weather), pick(p.weatherBoost)));
    const live = Math.round(Math.max(pick(p.liveEdge), pick(p.liveScore), pick(p.lineupScore), pick(p.lineupBoost)));

    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${name}</strong></td>
        <td>${team}</td>
        <td>${opponent}</td>
        <td>${tier}</td>
        <td>${board}</td>
        <td>${power}</td>
        <td>${pitch}</td>
        <td>${risk}</td>
        <td>${weather}</td>
        <td>${live}</td>
      </tr>
    `;
  }

  function ensureTable(){
    let table = document.querySelector("table");
    if (!table) {
      const wrap = document.querySelector("main") || document.querySelector(".wrap") || document.body;
      const holder = document.createElement("div");
      holder.innerHTML = `
        <table class="full-board-table">
          <thead>
            <tr>
              <th>Rank</th><th>Player</th><th>Team</th><th>Opponent</th><th>Tier</th><th>Board</th><th>Power</th><th>Pitch Edge</th><th>Pitcher Risk</th><th>Weather</th><th>Live Edge</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      `;
      wrap.appendChild(holder);
      table = holder.querySelector("table");
    }
    if (!table.querySelector("tbody")) table.appendChild(document.createElement("tbody"));
    return table;
  }

  async function loadData(){
    let data = null;
    for (const url of DATA_URLS) {
      try {
        const res = await fetch(url, {cache:"no-store"});
        if (res.ok) {
          data = await res.json();
          break;
        }
      } catch(e) {}
    }
    if (!data) throw new Error("Full Board data file did not load");

    const players = collectPlayers(data)
      .filter(p => p && typeof p === "object")
      .sort((a,b) => scoreOf(b) - scoreOf(a));

    const table = ensureTable();
    const tbody = table.querySelector("tbody");
    tbody.innerHTML = players.map(rowHtml).join("");

    const loading = Array.from(document.querySelectorAll("button, .pill, .status, #status"))
      .find(el => /loading/i.test(el.textContent || ""));
    if (loading) loading.textContent = `${players.length} Players`;

    const search = document.querySelector("input[type='search'], input[placeholder*='Search'], #search");
    if (search) {
      search.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        const filtered = players.filter(p => JSON.stringify(p).toLowerCase().includes(q));
        tbody.innerHTML = filtered.map(rowHtml).join("");
        if (loading) loading.textContent = `${filtered.length} Players`;
      });
    }
  }

  document.addEventListener("DOMContentLoaded", loadData);
})();
</script>
'''

text = re.sub(r'\s*<script>\s*\(function\(\)\{\s*const DATA_URLS = \[[\s\S]*?</script>\s*', '\n', text)

if "</body>" not in text:
    raise SystemExit("full-board.html missing </body>")

text = text.replace("</body>", fallback + "\n</body>", 1)

p.write_text(text)
print("Full Board rendering repaired")
