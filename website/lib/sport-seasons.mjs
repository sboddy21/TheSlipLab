// Inclusive month/day windows in America/New_York. Include postseason buffers.
// Exact season dates can override these recurring defaults when announced.
export const sportSeasons = {
  mlb: { start: '03-20', end: '11-07' },
  nfl: { start: '09-01', end: '02-15' },
  cfb: { start: '08-20', end: '01-31' },
  wnba: { start: '05-01', end: '10-31' },
  nba: { start: '10-15', end: '06-30' },
  nhl: { start: '10-01', end: '06-30' },
};

export function isSportInSeason(sport, now = new Date(), calendar = sportSeasons) {
  const season = calendar[sport];
  if (!season) return true;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = type => parts.find(value => value.type === type).value;
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  // Optional exact windows: [{ start: '2027-05-14', end: '2027-10-22' }].
  const exact = season.windows?.find(window => date >= window.start && date <= window.end);
  if (exact) return true;
  if (season.windows?.some(window => window.start.slice(0, 4) === part('year') || window.end.slice(0, 4) === part('year'))) return false;
  const day = date.slice(5);
  return season.start <= season.end
    ? day >= season.start && day <= season.end
    : day >= season.start || day <= season.end;
}
