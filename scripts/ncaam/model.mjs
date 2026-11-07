import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function newState() { return { season: null, teams: {} }; }
export function enterSeason(state, season, config) {
  if (state.season === season) return;
  if (state.season != null && season < state.season) throw new Error('Model games must be chronological');
  if (state.season != null) for (const team of Object.values(state.teams)) { team.rating=config.initialRating+(team.rating-config.initialRating)*config.seasonRetention; team.seasonGames=0; }
  state.season=season;
}
function team(state,id,config) { return state.teams[id] ||= { rating:config.initialRating, games:0, seasonGames:0 }; }
export function forecast(game,state,config) {
  const home=state.teams[game.home.id] || {rating:config.initialRating,games:0,seasonGames:0};
  const away=state.teams[game.away.id] || {rating:config.initialRating,games:0,seasonGames:0};
  const homeProbability=1/(1+10**((away.rating-home.rating-(game.neutral?0:config.homeAdvantage))/config.ratingScale));
  const side=homeProbability>=.5?'home':'away', probability=side==='home'?homeProbability:1-homeProbability;
  const hasTeamHistory=Math.min(home.games,away.games)>=config.minimumTeamGames;
  const eligible=hasTeamHistory&&probability>=config.minimumConfidence;
  return { modelVersion:config.version, homeProbability, awayProbability:1-homeProbability, side, probability, eligible, hasTeamHistory, homeRating:home.rating, awayRating:away.rating, earlySeason:Math.min(home.seasonGames,away.seasonGames)<8, reason:eligible?'Historical win-probability forecast':Math.min(home.games,away.games)<config.minimumTeamGames?'Insufficient team history':'Below confidence threshold' };
}
export function update(game,state,config) {
  if(!game.completed||!Number.isFinite(game.home.score)||!Number.isFinite(game.away.score)||game.home.score===game.away.score)return;
  enterSeason(state,game.season,config);
  const prediction=forecast(game,state,config),outcome=game.home.score>game.away.score?1:0;
  const home=team(state,game.home.id,config),away=team(state,game.away.id,config),change=config.kFactor*(outcome-prediction.homeProbability);
  home.rating+=change;away.rating-=change;for(const t of [home,away]){t.games++;t.seasonGames++;}
}
export function evaluate(rows,config) {
  const selected=rows.filter(r=>r.eligible),n=selected.length;
  if(!n)return {passed:false,picks:0,reasons:['No eligible holdout forecasts']};
  const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
  const brier=mean(selected.map(r=>(r.homeProbability-r.outcome)**2));
  const baselineBrier=mean(selected.map(r=>(r.baseline-r.outcome)**2));
  const differences=selected.map(r=>(r.baseline-r.outcome)**2-(r.homeProbability-r.outcome)**2);
  const skill=mean(differences),sd=Math.sqrt(mean(differences.map(d=>(d-skill)**2))),lower95=skill-1.96*sd/Math.sqrt(n);
  const bins=Array.from({length:4},(_,i)=>{const lower=.6+i*.1,upper=lower+.1;const bin=selected.filter(r=>r.probability>=lower-1e-10&&(i===3?r.probability<=1:r.probability<upper-1e-10));return {lower,upper,count:bin.length,meanProbability:bin.length?mean(bin.map(r=>r.probability)):null,winRate:bin.length?mean(bin.map(r=>r.correct)):null};});
  const calibrationError=bins.reduce((sum,b)=>sum+(b.count/n)*Math.abs((b.meanProbability||0)-(b.winRate||0)),0);
  const wins=selected.reduce((n,r)=>n+r.correct,0),rate=wins/n,z=1.96,den=1+z*z/n,center=(rate+z*z/(2*n))/den,half=z*Math.sqrt(rate*(1-rate)/n+z*z/(4*n*n))/den;
  const reasons=[];
  if(n<config.acceptance.minimumHoldoutPicks)reasons.push('Insufficient holdout sample');
  if(calibrationError>config.acceptance.maximumCalibrationError)reasons.push('Calibration error exceeds predeclared threshold');
  if(lower95<=0)reasons.push('Brier improvement confidence interval includes zero');
  return {passed:!reasons.length,reasons,games:rows.length,picks:n,wins,losses:n-wins,accuracy:rate,accuracy95:[center-half,center+half],brier,baselineBrier,brierImprovement:skill,brierImprovementLower95:lower95,calibrationError,bins,scope:'Straight-up winners only; no validated betting ROI, spread or total edge'};
}
