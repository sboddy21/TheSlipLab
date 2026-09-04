import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('MLB Decision Center requires a current complete health chain', () => {
  const html=fs.readFileSync('website/hr-decision-center.html','utf8');
  const body=html.match(/function verifiedBoardDeadline[\s\S]*?(?=\nfunction clean\()/)?.[0];
  assert(body); const gate=new Function(`${body};return verifiedBoardDeadline`)();
  const now=Date.now(), iso=n=>new Date(now+n).toISOString();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const board={pitcherDate:today,updatedAt:iso(-1000)};
  const health={status:'healthy',slateDate:today,monitoring:{state:'live',freshUntil:iso(600000)},artifacts:{games:{file:'mlb_games_today.json',required:true,freshness:'current',timestamp:iso(-1000),maxAgeSeconds:900}}};
  assert(gate(board,health)>now);
  assert.equal(gate(board,{...health,status:'delayed'}),0);
  assert.equal(gate(board,{...health,artifacts:{}}),0);
  assert(gate(board,{...health,artifacts:{games:{...health.artifacts.games,timestamp:iso(-901000)}}})<=now);
});

test('subscriber copy never calls unavailable WNBA data live or clear',()=>{
  const page=fs.readFileSync('website/wnba.html','utf8');
  assert.doesNotMatch(page,/Player projections live\.|<strong>Live<\/strong><small>Daily matchup projections/);
  assert.match(page,/Missing injury information does not mean a player is cleared/);
  assert.match(page,/Availability unknown:<\/strong> Current injury reports are unavailable/);
});

test('health UI fails closed and expires cached evidence',()=>{
  const source=fs.readFileSync('website/health-widget.js','utf8');
  assert.match(source,/!Number\.isFinite\(freshUntil\).*return "check"/);
  assert.match(source,/publicNavigationEnabled !== true/);
  assert.match(source,/Authorization = `Bearer \$\{token\}`/);
  assert.match(source,/if \(latestHealth\) render\(latestHealth\)/);
});
