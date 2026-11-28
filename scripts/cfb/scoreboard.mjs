const DAY_MS = 86400000;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const compact = date => date.toISOString().slice(0, 10).replaceAll('-', '');

export function scoreboardDates(start, finish) {
  const first = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const last = Date.UTC(finish.getUTCFullYear(), finish.getUTCMonth(), finish.getUTCDate());
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) return [];
  const dates = [];
  for (let time = first; time <= last; time += DAY_MS) dates.push(compact(new Date(time)));
  return dates;
}

async function fetchDay(date, fetchImpl) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date}&groups=80&limit=1000`;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
      const body = await response.text();
      if (!response.ok) {
        const detail = body.slice(0, 200).replace(/\s+/g, ' ').trim();
        const error = new Error(`ESPN returned ${response.status} for ${date}${detail ? `: ${detail}` : ''}`);
        if (!RETRYABLE_STATUSES.has(response.status)) throw error;
        lastError = error;
      } else {
        const data = JSON.parse(body);
        if (!Array.isArray(data.events) || data.events.length >= 1000) {
          throw new Error(`Missing or truncated ESPN events for ${date}`);
        }
        return data.events;
      }
    } catch (error) {
      lastError = error;
      if (/ESPN returned 4\d\d/.test(error.message) && !/ESPN returned (408|429)/.test(error.message)) throw error;
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
  }
  throw new Error(`ESPN request failed for ${date}: ${lastError?.message || 'unknown error'}`);
}

export async function fetchScoreboard(start, finish, fetchImpl = fetch) {
  const dates = scoreboardDates(start, finish);
  const dailyEvents = Array(dates.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, dates.length) }, async () => {
    while (cursor < dates.length) {
      const index = cursor++;
      dailyEvents[index] = await fetchDay(dates[index], fetchImpl);
    }
  }));
  return [...new Map(dailyEvents.flat().map(event => [event.id, event])).values()];
}
