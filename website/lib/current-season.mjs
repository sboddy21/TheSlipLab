// Current competitive season, using the user's Eastern calendar.
export function currentSeasonStart(sport, value = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
  const rollover = { nba: 10, nhl: 7, nfl: 3, cfb: 3 }[sport.toLowerCase()];
  return rollover && month < rollover ? year - 1 : year;
}

export function seasonStart(value) {
  const match = String(value ?? '').match(/^(\d{4})(?:$|[-/]\d{2,4}$|\d{4}$)/);
  return match ? Number(match[1]) : null;
}
