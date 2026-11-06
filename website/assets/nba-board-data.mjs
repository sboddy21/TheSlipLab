export async function loadNbaBoardData(get) {
 const files=['nba_games_today.json','nba_player_cards.json','nba_points.json','nba_rebounds.json','nba_assists.json','nba_threes.json','nba_first_basket.json','nba_market_lines.json'];
 const results=await Promise.allSettled(files.map(get));
 const values=results.map(row=>row.status==='fulfilled'?row.value:{});
 const missing=files.filter((file,i)=>results[i].status==='rejected');
 let [slate,cards,points,rebounds,assists,threes,firstBasket,markets]=values;
 if(!Array.isArray(slate.games)) {
  const live=await get('nba_workspace.json');
  if(!Array.isArray(live.games))throw Error('Current NBA schedule unavailable');
  slate={date:live.date,fetchedAt:live.fetchedAt,games:live.games.map(game=>({gameId:game.id,gameTimeUTC:game.date,gameStatusText:game.status,awayTeam:game.away,homeTeam:game.home}))};
  const byGame=new Map(slate.games.map(game=>[String(game.gameId),game]));
  cards={players:(live.players||[]).map(player=>({...player,playerId:player.id,team:player.team,gameTimeUTC:byGame.get(String(player.gameId))?.gameTimeUTC,gameStatusText:'Current roster · projections pending',recentGames:[]}))};
 }
 const ids=new Set(slate.games.map(game=>String(game.gameId)));
 const currentRows=rows=>(rows||[]).filter(row=>ids.has(String(row.gameId)));
 return {games:slate.games,date:slate.date,fetchedAt:slate.fetchedAt,cards:currentRows(cards.players),firstBasket,markets:{lines:[],...markets},models:{points:currentRows(points.players),rebounds:currentRows(rebounds.players),assists:currentRows(assists.players),threes:currentRows(threes.players)},missing};
}
