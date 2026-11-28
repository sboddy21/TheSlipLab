import fs from 'node:fs/promises';
import { newState, enterSeason, forecast, update, evaluate, hash } from './model.mjs';
const config=JSON.parse(await fs.readFile(new URL('./model-config.json',import.meta.url),'utf8'));
const games=JSON.parse(await fs.readFile(new URL('../../data/ncaam/history.json',import.meta.url),'utf8'));
const state=newState(),rows=[],counts={training:0,holdout:0};let homeWins=0,homeGames=0;
const boundary=Date.parse(config.holdoutWindow[0]+'T00:00:00Z');
for(const game of games){
 enterSeason(state,game.season,config);
 const prediction=forecast(game,state,config),outcome=game.home.score>game.away.score?1:0;
 if(Date.parse(game.kickoff)<boundary){counts.training++;if(!game.neutral){homeGames++;homeWins+=outcome;}}
 else {counts.holdout++;rows.push({id:game.id,kickoff:game.kickoff,...prediction,outcome,correct:(prediction.side==='home'?outcome:1-outcome),baseline:game.neutral?.5:homeWins/homeGames});}
 update(game,state,config);
}
const metrics=evaluate(rows,config);
const report={schemaVersion:1,sport:'NCAAM',generatedAt:new Date().toISOString(),modelVersion:config.version,config,configHash:hash(config),datasetHash:hash(games),modelStateHash:hash(state),...counts,trainingHomeWinRate:homeWins/homeGames,method:'Fixed-parameter Elo; train 2024–25, sequential out-of-season evaluation 2025–26. Each forecast is saved before that game updates ratings. No parameters fitted or selected using holdout outcomes.',...metrics,limitations:['ESPN public-score coverage, not an independently audited official results database.','Nominal 95% intervals treat games as independent; shared teams can create dependence.','No historical executable sportsbook prices were validated, so accuracy does not establish profitability.','Transfers and roster turnover are represented only by preseason rating regression.','Early-season forecasts carry extra uncertainty.']};
await fs.writeFile(new URL('../../website/data/ncaam_validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
await fs.writeFile(new URL('../../website/data/ncaam_model.json',import.meta.url),JSON.stringify({schemaVersion:1,modelVersion:config.version,configHash:hash(config),datasetHash:hash(games),validatedThrough:config.holdoutWindow[1],state},null,2)+'\n');
await fs.writeFile(new URL('../../data/ncaam/holdout-predictions.json',import.meta.url),JSON.stringify(rows)+'\n');
console.log(JSON.stringify(report,null,2));
