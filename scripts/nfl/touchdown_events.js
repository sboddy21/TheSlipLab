const clean = value => String(value || "").trim();
const teamCode = value => clean(typeof value === "object" ? value?.abbreviation || value?.name : value);

function touchdownKind(type = "", text = "") {
  const value = `${type} ${text}`.toLowerCase();
  if (value.includes("pass")) return "receiving";
  if (value.includes("rush") || value.includes("run")) return "rushing";
  if (value.includes("interception")) return "interception_return";
  if (value.includes("punt return")) return "punt_return";
  if (value.includes("kickoff return")) return "kickoff_return";
  if (value.includes("fumble")) return "fumble_return";
  return "other";
}

function parseTouchdownText(text = "", type = "") {
  const description = clean(text);
  const kind = touchdownKind(type, description);
  const withoutTry = description.replace(/\s*\([^)]*(?:Kick|PAT|Two-Point|Two Point)[^)]*\)\s*$/i, "").trim();
  const passing = withoutTry.match(/^(.+?)\s+(\d+)\s+Yd\s+pass from\s+(.+)$/i);
  const yardage = withoutTry.match(/\b(\d+)\s+Yd\b/i);
  let scorerName = "Scorer unavailable", passerName = null;
  if (passing) {
    scorerName = clean(passing[1]);
    passerName = clean(passing[3]);
  } else {
    const marker = withoutTry.match(/^(.+?)\s+(?:\d+\s+Yd\s+)?(?:Rush|Run|Interception Return|Punt Return|Kickoff Return|Fumble Return)/i);
    if (marker) scorerName = clean(marker[1]);
    else if (withoutTry) scorerName = clean(withoutTry.split(/\s+\d+\s+Yd\b/i)[0]);
  }
  return { scorerName, passerName, yards: yardage ? Number(yardage[1]) : null, kind };
}

const labels = {
  receiving: "Receiving TD",
  rushing: "Rushing TD",
  interception_return: "Pick-six",
  punt_return: "Punt-return TD",
  kickoff_return: "Kick-return TD",
  fumble_return: "Fumble-return TD",
  other: "Touchdown"
};

export function extractTouchdownEvents(summary, game) {
  const competition = summary.header?.competitions?.[0] || {};
  const status = competition.status?.type || {};
  const away = teamCode(game.awayTeam), home = teamCode(game.homeTeam);
  const roster = new Map();
  for (const teamBox of summary.boxscore?.players || []) for (const category of teamBox.statistics || []) for (const row of category.athletes || []) {
    if (row.athlete?.displayName && row.athlete?.id) roster.set(row.athlete.displayName.toLowerCase(), String(row.athlete.id));
  }
  return (summary.scoringPlays || [])
    .filter(play => play.scoringType?.name === "touchdown" || /touchdown/i.test(play.type?.text || ""))
    .map((play, index) => {
      const parsed = parseTouchdownText(play.text, play.type?.text);
      const team = clean(play.team?.abbreviation), opponent = team === away ? home : away;
      return {
        eventId: `${game.gameId}|${play.id || index}`,
        playId: String(play.id || index),
        gameId: String(game.gameId),
        week: Number(game.week),
        kickoffUTC: game.kickoffUTC,
        venue: game.venue || "",
        awayTeam: away,
        homeTeam: home,
        team,
        opponent,
        scorerId: roster.get(parsed.scorerName.toLowerCase()) || null,
        scorerName: parsed.scorerName,
        passerId: parsed.passerName ? roster.get(parsed.passerName.toLowerCase()) || null : null,
        passerName: parsed.passerName,
        scoringType: parsed.kind,
        scoringLabel: labels[parsed.kind],
        yards: parsed.yards,
        description: clean(play.text),
        period: Number(play.period?.number) || null,
        clock: clean(play.clock?.displayValue),
        awayScore: Number(play.awayScore) || 0,
        homeScore: Number(play.homeScore) || 0,
        gameState: status.state || "unknown",
        gameStatus: status.detail || "",
        completed: Boolean(status.completed)
      };
    });
}

export { parseTouchdownText };
