(function(root){
  const markets=["points","rebounds","assists","threes"];
  const targets={points:5.5,rebounds:2.5,assists:2,threes:1.1};
  const round=value=>Number(Number(value).toFixed(1));
  const tier=confidence=>confidence>=82?"High":confidence>=72?"Medium":"Developing";
  const flatten=history=>(history?.slates||[]).flatMap(slate=>(slate.projections||[]).filter(row=>row.actual).map(row=>({...row,slateDate:slate.date})));
  const error=(row,market)=>Number.isFinite(Number(row.errors?.[market]))?Number(row.errors[market]):Math.abs(Number(row.projections?.[market]?.value)-Number(row.actual?.[market]));
  function summarizeRows(rows){
    const marketMetrics=Object.fromEntries(markets.map(market=>{const errors=rows.map(row=>error(row,market)).filter(Number.isFinite);const within=errors.filter(value=>value<=targets[market]).length;return [market,{samples:errors.length,mae:errors.length?round(errors.reduce((sum,value)=>sum+value,0)/errors.length):null,withinTarget:errors.length?round(within/errors.length*100):null,target:targets[market]}]}));
    return {rows:rows.length,markets:marketMetrics};
  }
  function calculate(history){
    const rows=flatten(history);const dates=[...new Set(rows.map(row=>row.slateDate))].sort().reverse();
    const confidenceTiers=["High","Medium","Developing"].map(name=>{const tierRows=rows.filter(row=>tier(Number(row.confidence))===name);const summary=summarizeRows(tierRows);const normalizedErrors=tierRows.flatMap(row=>markets.map(market=>error(row,market)/targets[market])).filter(Number.isFinite);return {name,players:tierRows.length,errorVsTarget:normalizedErrors.length?round(normalizedErrors.reduce((sum,value)=>sum+value,0)/normalizedErrors.length):null,markets:summary.markets}});
    const recentSlates=dates.slice(0,7).map(date=>{const slateRows=rows.filter(row=>row.slateDate===date);return {date,players:slateRows.length,markets:summarizeRows(slateRows).markets}});
    return {gradedPlayers:rows.length,gradedSlates:dates.length,markets:summarizeRows(rows).markets,confidenceTiers,recentSlates,rows:rows.sort((a,b)=>b.slateDate.localeCompare(a.slateDate)||b.confidence-a.confidence)};
  }
  root.TSLWnbaResultsMetrics={calculate,targets,markets};
})(globalThis);
