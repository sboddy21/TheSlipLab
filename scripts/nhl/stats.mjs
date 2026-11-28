import { NHL_STATS } from './core.mjs';

export async function fetchNhlSeasonSkaters(seasonId, json) {
  const rows = [], seen = new Set();
  let total = null;
  for (let page = 0; page < 30; page++) {
    const query = new URLSearchParams({ isAggregate: 'true', isGame: 'false', start: String(rows.length), limit: '100', sort: JSON.stringify([{ property: 'playerId', direction: 'ASC' }]), factCayenneExp: 'gamesPlayed>=1', cayenneExp: `seasonId=${seasonId} and gameTypeId=2` });
    const data = await json(`${NHL_STATS}/skater/summary?${query}`);
    if (!Array.isArray(data.data)) throw Error('NHL skater summary is incomplete');
    if (Number.isFinite(data.total)) total = Number(data.total);
    for (const row of data.data) {
      if (!row.playerId || seen.has(String(row.playerId))) throw Error('NHL skater pagination returned missing or duplicate identities');
      seen.add(String(row.playerId)); rows.push(row);
    }
    if (total !== null && rows.length >= total) return { seasonId: Number(seasonId), rows };
    if (!data.data.length || (total === null && data.data.length < 100)) {
      if (total !== null && rows.length < total) throw Error('NHL skater pagination stopped before complete coverage');
      return { seasonId: Number(seasonId), rows };
    }
  }
  throw Error('NHL skater pagination exceeded bounded coverage limit');
}
