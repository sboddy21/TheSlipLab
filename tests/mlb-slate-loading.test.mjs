import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('website/slate_matchup_renderer.js','utf8');
const loader=source.slice(source.indexOf('  async function load() {'),source.indexOf('  load().catch'));
test('a verified empty MLB slate renders without waiting for any optional research',async()=>{
 const calls=[];let rendered=0;
 const context={Promise,state:{},injectStyles(){},injectPlayerSignalStyles(){},injectGuidedPickerStyles(){},injectShell(){},restoreGameComparison(){},json:async file=>{calls.push(file);return{};},isVerifiedClosedSlate:()=>true,render:()=>rendered++};
 await vm.runInNewContext(loader+'\nload();',context);
 assert.equal(rendered,1);assert.deepEqual(calls.sort(),['./data/health_status.json','./data/mlb_games_today.json']);
});
test('failed MLB loading cannot leave the initial loading text forever',()=>{
 assert.ok(source.includes('signal: AbortSignal.timeout(15000)'));
 assert.ok(source.includes('load().catch'));
 assert.ok(source.includes('The current MLB board could not be loaded. Refresh to retry.'));
});
