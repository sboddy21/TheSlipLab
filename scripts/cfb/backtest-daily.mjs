import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { walkForward,summarize } from './evaluation.mjs';
import { evaluateCalibrated,qualification } from './calibration.mjs';
const text=await fs.readFile(new URL('./daily-model.json',import.meta.url),'utf8'),manifest=JSON.parse(text);
const history=JSON.parse(await fs.readFile(new URL('../../data/cfb/history.json',import.meta.url),'utf8'));
const current=JSON.parse(await fs.readFile(new URL('../../data/cfb/current-season.json',import.meta.url),'utf8'));
const games=[...new Map([...history.games,...current.games].map(g=>[g.id,g])).values()];
const reports={},predictions={};
for(const season of [2025,2026]) {
  const e=walkForward(games,season,manifest.config),summary=summarize(e),calibrated=evaluateCalibrated(e.rows,manifest.calibration);
  reports[season]={season,evidenceType:season===2025?'Reused historical diagnostic; not a fresh holdout':'New early-season retrospective evaluation; not a prospective track record',
    summary,probabilityScores:calibrated.probabilityScores,strategy:calibrated.strategy,skipped:e.skipped.length};
  predictions[season]={rows:e.rows,calibratedPicks:calibrated.picks,skipped:e.skipped};
  console.log(JSON.stringify({season,predicted:e.rows.length,calibrated:calibrated.strategy},null,2));
}
const report={schemaVersion:2,model:manifest.model,configSha256:crypto.createHash('sha256').update(text).digest('hex'),
  generatedAt:new Date().toISOString(),frozenAt:manifest.frozenAt,calibration:manifest.calibration,config:manifest.config,protocol:manifest.protocol,
  sourceRetrievedAt:current.retrievedAt,historySha256:crypto.createHash('sha256').update(JSON.stringify(games)).digest('hex'),reports,
  prospective:{spread:qualification([],manifest.protocol.promotion),total:qualification([],manifest.protocol.promotion)},
  conclusion:'No reliable betting edge established. Historical calibration and retrospective returns do not qualify a market without sufficient independently recorded forward evidence.',
  limitations:['2025 was already inspected; this rerun is diagnostic rather than a new holdout.','2026 early-season results are retrospective and too small for reliability claims.','Archived closing quotes lack independently verified publication timestamps.','Injury and roster adjustments are not available; weather is descriptive, not a model input.','The combined strategy may have correlated picks; confidence intervals resample entire weeks.']};
await fs.writeFile(new URL('../../website/data/cfb_daily_evaluation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
await fs.writeFile(new URL('../../website/data/cfb_daily_predictions.json',import.meta.url),JSON.stringify({model:manifest.model,configSha256:report.configSha256,predictions})+'\n');
const rows=Object.values(reports).map(r=>{const p=r.strategy.combined;return `| ${r.season} | ${r.summary.predictedGames} | ${p.wins}–${p.losses}–${p.pushes} | ${(100*(p.roi??0)).toFixed(2)}% | ${p.roi95?p.roi95.map(x=>(100*x).toFixed(2)+'%').join(' to '):'Insufficient weeks'} |`;});
await fs.writeFile(new URL('../../docs/cfb-daily-evaluation.md',import.meta.url),`# Daily ratings and calibrated value evaluation\n\n${report.conclusion}\n\nCalibration was frozen at ${manifest.frozenAt}, trained on 2024 walk-forward predictions only. Rating parameters were not retuned after the original 2025 results. The strategy requires an estimated return of at least 5% at the actual archived price; there is no guarantee the estimated return is accurate.\n\n| Season | Predictions | Calibrated picks W–L–P | ROI | 95% whole-week bootstrap ROI |\n|---|---:|---:|---:|---|\n${rows.join('\n')}\n\n2025 is a reused diagnostic, and 2026 is a small newly evaluated retrospective sample. Neither is a substitute for a pregame recorded forward track record.\n\nQualification requires, per market, 200 settled prospective picks across eight weeks, a positive 95% weekly-bootstrap ROI lower bound, and positive returns in both halves. No market qualifies today. The live board computes this gate from its immutable versioned ledger, using only entries recorded after the calibration freeze and before kickoff.\n\nFull probability scores, including Brier scores, log loss and calibration bins: website/data/cfb_daily_evaluation.json. Every prediction and simulated pick: website/data/cfb_daily_predictions.json.\n\n${report.limitations.map(x=>'- '+x).join('\n')}\n`);
