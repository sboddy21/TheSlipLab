import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { walkForward } from './evaluation.mjs';
import { fitCalibration } from './calibration.mjs';
import { DAILY_MODEL } from './ratings.mjs';
const history=JSON.parse(await fs.readFile(new URL('../../data/cfb/history.json',import.meta.url),'utf8'));
const existing=JSON.parse(await fs.readFile(new URL('./model-config.json',import.meta.url),'utf8'));
const protocol=JSON.parse(await fs.readFile(new URL('./edge-protocol.json',import.meta.url),'utf8'));
const config={...existing.config,cadence:'daily'};
const development=walkForward(history.games,2024,config);
const calibration={spread:fitCalibration(development.rows,'spread'),total:fitCalibration(development.rows,'total')};
if(!calibration.spread||!calibration.total)throw new Error('Insufficient calibration history');
const manifest={model:DAILY_MODEL,frozenAt:new Date().toISOString(),selectionSeason:2024,config,calibration,protocol,
  developmentGames:development.rows.length,sourceHash:crypto.createHash('sha256').update(JSON.stringify(history.games.filter(g=>g.season<=2024))).digest('hex')};
await fs.writeFile(new URL('./daily-model.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({frozenAt:manifest.frozenAt,developmentGames:manifest.developmentGames,calibration},null,2));
