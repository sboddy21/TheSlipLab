import { number } from './core.mjs';

// Known pregame books only. Live-odds providers and current/open fields are never fallbacks.
export function closingMarket(data, game) {
  const choices = ['100','58'];
  for (const id of choices) {
    const o = data.items?.find(o=>String(o.provider?.id)===id && !/live/i.test(o.provider?.name || ''));
    if (!o) continue;
    const teamId = side => o[`${side}TeamOdds`]?.team?.$ref?.match(/\/teams\/(\d+)/)?.[1];
    if (teamId('home') && teamId('home')!==game.home.id || teamId('away') && teamId('away')!==game.away.id) continue;
    const home = o.homeTeamOdds?.close, away=o.awayTeamOdds?.close;
    let homeSpread=number(home?.pointSpread?.american), awaySpread=number(away?.pointSpread?.american);
    if (homeSpread===null || awaySpread===null || Math.abs(homeSpread+awaySpread)>0.001) homeSpread=null;
    const total=number(o.close?.total?.american);
    if (homeSpread===null && !(total>0)) continue;
    return {provider:o.provider.name,providerId:id,kind:'archived-close',homeSpread,total:total>0?total:null,
      homePrice:number(home?.spread?.american),awayPrice:number(away?.spread?.american),
      homeML:number(home?.moneyLine?.american),awayML:number(away?.moneyLine?.american),
      overPrice:number(o.close?.over?.american),underPrice:number(o.close?.under?.american)};
  }
  return null;
}
