import {catalogPropEvents} from '../odds/catalog-to-props.mjs';
import fs from 'node:fs';
import {proplineRequest,proplineSettings,normalizePropLineBooks,PROPLINE_BOOKS} from '../providers/propline.mjs';
const read=n=>JSON.parse(fs.readFileSync(`website/data/${n}.json`));
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const map={player_points:'points',player_rebounds:'rebounds',player_assists:'assists',player_threes:'threes'};
const games=read('wnba_games_today'),players=read('wnba_player_baselines');
let catalogEvents=null;try{catalogEvents=catalogPropEvents(read('odds_wnba'));}catch{}
const output={sport:'WNBA',date:games.date,source:'PropLine',fetchedAt:new Date().toISOString(),authorizedSources:[],lines:[],rejections:[],status:'unavailable',timestampMeaning:'Provider observation time, not necessarily bookmaker publication time'};
try{
 if(!proplineSettings().key)throw new Error('PropLine key is not configured');
 output.authorizedSources=[...PROPLINE_BOOKS].map(book=>`PropLine:${book}`);
 const upcoming=(games.games||[]).filter(g=>g.state==='pre'&&Date.parse(g.gameTimeUTC)>Date.now());
 if(!upcoming.length)output.status='no_current_pregame_games';
 else if(players.stale)output.status='stale_player_identity_data';
 else {
  const response=catalogEvents?{data:catalogEvents}:await proplineRequest('/sports/basketball_wnba/events');
  for(const game of upcoming){
   const matches=response.data.filter(e=>norm(e.home_team)===norm(game.homeTeam.name)&&norm(e.away_team)===norm(game.awayTeam.name)&&Math.abs(Date.parse(e.commence_time)-Date.parse(game.gameTimeUTC))<=5*60_000);
   if(matches.length!==1){output.rejections.push({gameId:game.gameId,reason:'event_identity_not_unique'});continue;}
   const event=matches[0];const odds=catalogEvents?{data:catalogEvents.find(e=>e.id===event.id)}:await proplineRequest(`/sports/basketball_wnba/events/${encodeURIComponent(event.id)}/odds?markets=${Object.keys(map).join(',')}`);
   if(String(odds.data.id)!==String(event.id)){output.rejections.push({gameId:game.gameId,reason:'response_event_mismatch'});continue;}
   for(const book of normalizePropLineBooks(odds.data))for(const market of book.markets){
    if(!map[market.key])continue;
    const timestamp=Date.parse(market.last_update);if(!Number.isFinite(timestamp)||Date.now()-timestamp<0||Date.now()-timestamp>20*60_000)continue;
    for(const over of market.outcomes.filter(o=>o.name==='Over')){
     if(over.point==null||!Number.isFinite(Number(over.point)))continue;
     const under=market.outcomes.find(o=>o.name==='Under'&&o.description===over.description&&o.point===over.point);
     if(!under||![over.price,under.price].every(p=>p!=null&&Number.isFinite(Number(p))&&Math.abs(Number(p))>=100))continue;
     const roster=players.players.filter(p=>norm(p.player)===norm(over.description)&&[game.homeTeam.abbreviation,game.awayTeam.abbreviation].includes(p.teamAbbreviation));
     if(roster.length!==1){output.rejections.push({gameId:game.gameId,player:over.description,reason:'player_identity_not_unique'});continue;}
     const source=`PropLine:${book.key}`;output.authorizedSources.push(source);
     output.lines.push({gameId:game.gameId,playerId:roster[0].playerId,player:roster[0].player,market:map[market.key],line:Number(over.point),overOdds:Number(over.price),underOdds:Number(under.price),source,fetchedAt:market.last_update,providerEventId:event.id});
    }
   }
  }
  output.status=output.lines.length?'available':'no_matching_props';
 }
}catch(error){output.status='unavailable';output.error=error.message;output.lines=[];}
output.authorizedSources=[...new Set(output.authorizedSources)];output.fetchedAt=new Date().toISOString();
fs.writeFileSync('website/data/wnba_market_lines.json',JSON.stringify(output,null,2)+'\n');
console.log(`WNBA PROP FEED: ${output.status}; ${output.lines.length} paired prices`);
