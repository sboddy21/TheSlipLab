export const RATING_MODEL = 'opponent-adjusted-ridge-v2';
export const DAILY_MODEL = 'opponent-adjusted-daily-v3';
export function dayCutoff(date) { const d=new Date(date); d.setUTCHours(0,0,0,0); return d.getTime(); }
export const DEFAULT_CONFIG = Object.freeze({ ridge: 5, halfLifeDays: 180, windowDays: 730, minGames: 4, homePrior: 2.5, homeRidge: 20 });
const DAY = 86400000;

// Weekly snapshots prevent a target's result or another game later that week from entering training.
export function weekCutoff(date) {
  const d = new Date(date);
  d.setUTCHours(0,0,0,0);
  d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  return d.getTime();
}
export function trainingGames(history, cutoff, config = DEFAULT_CONFIG) {
  config = {...DEFAULT_CONFIG,...config};
  return [...new Map(history.map(g=>[g.id,g])).values()].filter(g=>g.completed && !g.canceled &&
    Number.isFinite(g.home?.score) && Number.isFinite(g.away?.score) &&
    Date.parse(g.date) < cutoff-DAY && Date.parse(g.date) >= cutoff-config.windowDays*DAY);
}

// Weighted ridge regression: score = mean + offense(team) - defense(opponent) +/- home/2.
// Fit by cyclic coordinate descent, maintaining residuals; all shrinkage priors are fixed before the holdout.
export function fitRatings(history, cutoff, options = {}) {
  const config = {...DEFAULT_CONFIG,...options};
  const games = trainingGames(history,cutoff,config);
  if (!games.length) return null;
  const ids = [...new Set(games.flatMap(g=>[g.home.id,g.away.id]))].sort();
  const index = new Map(ids.map((id,i)=>[id,i]));
  const size = ids.length*2+2, homeIndex = size-1;
  const beta = new Float64Array(size); beta[0]=28; beta[homeIndex]=config.homePrior;
  const columns = Array.from({length:size},()=>[]), rows=[];
  for (const g of games) {
    const weight = 2**(-(cutoff-Date.parse(g.date))/DAY/config.halfLifeDays);
    for (const side of ['home','away']) {
      const other = side === 'home' ? 'away' : 'home';
      const terms = [[0,1],[1+index.get(g[side].id),1],[1+ids.length+index.get(g[other].id),-1],
        [homeIndex,g.neutral ? 0 : side === 'home' ? 0.5 : -0.5]];
      const row = {weight,residual:g[side].score-terms.reduce((s,[j,x])=>s+beta[j]*x,0)};
      const rowIndex = rows.push(row)-1;
      for (const [j,x] of terms) if(x) columns[j].push([rowIndex,x]);
    }
  }
  let iterations = 0, converged = false;
  for (;iterations<500;iterations++) {
    let maxChange=0;
    for (let j=0;j<size;j++) {
      const penalty = j === 0 ? 0 : j === homeIndex ? config.homeRidge : config.ridge;
      const prior = j === homeIndex ? config.homePrior : 0;
      let numerator = penalty*prior, denominator=penalty;
      for (const [i,x] of columns[j]) { numerator += rows[i].weight*x*(rows[i].residual+x*beta[j]); denominator += rows[i].weight*x*x; }
      const next = denominator ? numerator/denominator : beta[j], delta=next-beta[j];
      beta[j]=next; maxChange=Math.max(maxChange,Math.abs(delta));
      for (const [i,x] of columns[j]) rows[i].residual-=delta*x;
    }
    if(maxChange<1e-7) {converged=true;break;}
  }
  const teams = {};
  ids.forEach((id,i)=>{
    const recent = games.filter(g=>g.home.id===id || g.away.id===id).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
    const qualifying = recent.filter(g=>cutoff-Date.parse(g.date)<370*DAY);
    teams[id]={offense:beta[1+i],defense:beta[1+ids.length+i],rating:beta[1+i]+beta[1+ids.length+i],
      games:qualifying.length,lastGame:recent[0].date,pointsFor:beta[0]+beta[1+i],pointsAgainst:beta[0]-beta[1+ids.length+i]};
  });
  return {model:config.cadence === "daily" ? DAILY_MODEL : RATING_MODEL,config,cutoff:new Date(cutoff).toISOString(),trainingCount:games.length,
    latestTrainingGame:games.reduce((latest,g)=>g.date>latest?g.date:latest,''),mean:beta[0],homeAdvantage:beta[homeIndex],teams,converged,iterations};
}
export function predictRatings(game, fit) {
  if (!fit?.converged || Date.parse(game.date)<Date.parse(fit.cutoff)) return null;
  const home = fit.teams[game.home.id], away = fit.teams[game.away.id];
  if (!home || !away || home.games<fit.config.minGames || away.games<fit.config.minGames) return null;
  const field = game.neutral ? 0 : fit.homeAdvantage/2;
  const homeScore = Math.max(0,fit.mean+home.offense-away.defense+field);
  const awayScore = Math.max(0,fit.mean+away.offense-home.defense-field);
  return {model:fit.model,homeScore,awayScore,margin:homeScore-awayScore,total:homeScore+awayScore,home,away,
    trainingCutoff:fit.cutoff,trainingCount:fit.trainingCount,homeAdvantage:game.neutral?0:fit.homeAdvantage};
}
