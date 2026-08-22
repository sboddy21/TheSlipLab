(function(root){
  const isWnba=favorite=>favorite?.sport==="WNBA";
  const matches=(row,favorite)=>isWnba(favorite)&&((favorite.entity_type==="player"&&String(favorite.external_id)===String(row.playerId))||(favorite.entity_type==="team"&&String(favorite.external_id).toUpperCase()===String(row.team).toUpperCase()));
  const filterRows=(rows,favorites)=>(rows||[]).filter(row=>(favorites||[]).some(favorite=>matches(row,favorite)));
  const find=(favorites,type,id)=>(favorites||[]).find(favorite=>isWnba(favorite)&&favorite.entity_type===type&&String(favorite.external_id)===String(id));
  root.TSLWnbaPersonalization={matches,filterRows,find};
})(globalThis);
