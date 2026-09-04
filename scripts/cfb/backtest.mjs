import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG,RATING_MODEL } from './ratings.mjs';
import { walkForward,summarize } from './evaluation.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=await fs.readFile(`${root}data/cfb/history.json`,'utf8'),history=JSON.parse(source);
const configPath=`${root}scripts/cfb/model-config.json`;
const development=process.argv.includes('--develop');
if(development) {
  const trials=[];
  // Only 2024 scores select settings. 2025 is never used to rank or select candidates.
  for(const ridge of [2,5,10])for(const halfLifeDays of [120,240]) {
    const config={...DEFAULT_CONFIG,ridge,halfLifeDays};
    const result=summarize(walkForward(history.games,2024,config));
    trials.push({config,objective:result.margin.mae+result.total.mae,summary:result});
    console.log(`Development ridge=${ridge}, halfLife=${halfLifeDays}: margin MAE ${result.margin.mae.toFixed(3)}, total MAE ${result.total.mae.toFixed(3)}`);
  }
  trials.sort((a,b)=>a.objective-b.objective);
  const manifest={model:RATING_MODEL,selectedAt:new Date().toISOString(),selectionSeason:2024,holdoutSeason:2025,
    selectionRule:'Minimize 2024 walk-forward margin MAE + total MAE. No odds or 2025 outcomes used to select settings.',
    config:trials[0].config,trials};
  await fs.writeFile(configPath,JSON.stringify(manifest,null,2)+'\n');
  console.log('Selected and saved configuration. Run npm run cfb:backtest for the held-out 2025 season.');
} else {
  const configText=await fs.readFile(configPath,'utf8'),manifest=JSON.parse(configText);
  if(manifest.selectionSeason!==2024||manifest.holdoutSeason!==2025)throw new Error('Unexpected evaluation protocol');
  const evaluation=walkForward(history.games,2025,manifest.config),summary=summarize(evaluation);
  const byWeek=[...new Set(evaluation.rows.map(r=>r.fold))].sort().map(fold=>{
    const rows=evaluation.rows.filter(r=>r.fold===fold);return {fold,games:rows.length,marginMAE:rows.reduce((s,r)=>s+Math.abs(r.predictedMargin-r.actualMargin),0)/rows.length};
  });
  const report={schemaVersion:1,model:RATING_MODEL,generatedAt:new Date().toISOString(),season:2025,developmentSeason:2024,
    config:manifest.config,configSha256:crypto.createHash('sha256').update(configText).digest('hex'),
    dataSha256:crypto.createHash('sha256').update(source).digest('hex'),retrievedAt:history.retrievedAt,
    protocol:'Retrospective weekly walk-forward test. Settings selected on 2024 only, frozen for 2025. Each Monday 00:00 UTC fit uses final games kicked off at least 24 hours earlier. Earlier 2025 results enter later 2025 fits; target and later-week results never enter their own fit. No odds are model inputs.',
    oddsPolicy:history.oddsPolicy,limitations:['Retrospective closing quotes, not independently timestamped executable offers.','Historical scores may include later corrections; not a point-in-time source archive.','No roster, injury, weather or pace inputs.','ATS Wilson intervals treat games as independent; MAE intervals resample entire weeks.','Research simulation, not live ledger results. No guarantee of future performance.'],
    coverage:{allFinalGames:evaluation.eligibleGames,predicted:summary.predictedGames,skipped:summary.skippedGames,
      finalGamesWithClosingMarkets:history.games.filter(g=>g.season===2025&&g.completed&&g.market).length},
    summary,byWeek};
  await fs.writeFile(`${root}website/data/cfb_backtest.json`,JSON.stringify(report,null,2)+'\n');
  await fs.writeFile(`${root}website/data/cfb_backtest_predictions.json`,JSON.stringify({model:RATING_MODEL,configSha256:report.configSha256,rows:evaluation.rows,skipped:evaluation.skipped})+'\n');
  const f=n=>n==null?'n/a':n.toFixed(2),pct=n=>n==null?'n/a':`${(100*n).toFixed(1)}%`;
  const s=summary,b=s.sportsbook;
  const md=`# College football: 2025 out-of-sample evaluation\n\n${report.protocol}\n\nModel: ${RATING_MODEL}. Config hash: ${report.configSha256}.\n\n## Coverage\n\n${s.predictedGames}/${s.eligibleGames} final games projected; ${s.skippedGames} skipped for insufficient history. Closing spreads: ${b.spreadGames}; totals: ${b.totalGames}.\n\n## Prediction accuracy\n\n| Matched comparison | Adjusted model | Comparator |\n|---|---:|---:|\n| Margin MAE vs old baseline (${s.baselineComparison.games} games) | ${f(s.baselineComparison.modelMargin.mae)} | ${f(s.baselineComparison.baselineMargin.mae)} |\n| Total MAE vs old baseline | ${f(s.baselineComparison.modelTotal.mae)} | ${f(s.baselineComparison.baselineTotal.mae)} |\n| Margin MAE vs closing spread (${b.spreadGames} games) | ${f(b.modelMargin.mae)} | ${f(b.bookMargin.mae)} |\n| Total MAE vs closing total (${b.totalGames} games) | ${f(b.modelTotal.mae)} | ${f(b.bookTotal.mae)} |\n\nLower MAE is better. Model-minus-book margin MAE difference: ${f(b.marginDifference?.meanDifference)}; 95% weekly bootstrap interval: ${b.marginDifference?.interval95.map(f).join(' to ')}. Total: ${f(b.totalDifference?.meanDifference)} (${b.totalDifference?.interval95.map(f).join(' to ')}).\n\n## Closing-line simulation\n\n| Strategy | W–L–P | Win rate | Net units | ROI |\n|---|---:|---:|---:|---:|\n${['spread','total','combined'].map(k=>{const p=s.strategy[k];return `| ${k} | ${p.wins}–${p.losses}–${p.pushes} | ${pct(p.winRate)} | ${f(p.units)} | ${pct(p.roi)} |`;}).join('\n')}\n\nOne unit risked per qualifying pick at its archived American price, including pushes in the ROI denominator. Spread threshold: 4 points; total threshold: 6 points; unchanged from v1 and not optimized on either season. No default -110 prices.\n\n## Source and limits\n\n${history.oddsPolicy}\n\n${report.limitations.map(l=>'- '+l).join('\n')}\n\nFull predictions and excluded-game IDs: website/data/cfb_backtest_predictions.json. Per-week metrics, confidence intervals and coverage: website/data/cfb_backtest.json.\n`;
  await fs.writeFile(`${root}docs/cfb-backtest-2025.md`,md);
  console.log(JSON.stringify({coverage:report.coverage,summary},null,2));
}
