export async function fetchScoreboard(date, fetcher = fetch) {
  const response = await fetcher(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${date.replaceAll('-', '')}&groups=50&limit=1000`, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`NCAAM scoreboard HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.events)) throw new Error('Invalid NCAAM scoreboard');
  return payload.events;
}
