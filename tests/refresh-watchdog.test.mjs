import test from 'node:test';
import assert from 'node:assert/strict';
import {needsRecovery,recoveryAgeMinutes,targets} from '../scripts/refresh-watchdog.mjs';
const now=Date.parse('2026-11-06T16:00:00Z');
const old={generatedAt:'2026-11-06T14:00:00Z',date:'2026-11-06'};
test('watchdog recovers stale, missing and wrong-day data',()=>{
 assert.equal(needsRecovery(old,null,{now}),true);
 assert.equal(needsRecovery(null,null,{now}),true);
 assert.equal(needsRecovery({...old,generatedAt:'2026-11-06T15:59:00Z',date:'2026-11-05'},null,{now}),true);
 assert.equal(needsRecovery({...old,generatedAt:'2026-11-06T15:59:00Z'},null,{now}),false);
});
test('watchdog never duplicates active jobs and bounds provider-failure retries',()=>{
 for(const status of ['queued','in_progress','waiting'])assert.equal(needsRecovery(old,{status},{now}),false);
 assert.equal(needsRecovery(old,{status:'completed',conclusion:'failure',created_at:'2026-11-06T15:45:00Z'},{now}),false);
 assert.equal(needsRecovery(old,{status:'completed',conclusion:'failure',created_at:'2026-11-06T15:00:00Z'},{now}),true);
});

test('every sport stays covered during the offseason, including college basketball',()=>{
 assert.ok(targets.some(([sport])=>sport==='ncaam'));
 assert.equal(recoveryAgeMinutes('nba',45,new Date('2026-07-15T16:00:00Z')),1440);
 assert.equal(recoveryAgeMinutes('nba',45,new Date('2026-11-15T16:00:00Z')),45);
 assert.equal(recoveryAgeMinutes('odds',15,new Date('2026-07-15T16:00:00Z')),15);
});

test('a fresh primary file cannot hide a stale sibling board or source timestamp',async()=>{
 const {needsBoardRecovery,recoveryFiles}=await import('../scripts/refresh-watchdog.mjs');
 const fresh={date:'2026-11-06',generatedAt:'2026-11-06T15:59:00Z'};
 const payloads=Object.fromEntries(recoveryFiles.nba.map(file=>[file,fresh]));
 assert.equal(needsBoardRecovery('nba',payloads,null,{now}),false);
 payloads['nba_assists.json']=old;assert.equal(needsBoardRecovery('nba',payloads,null,{now}),true);
 assert.equal(needsBoardRecovery('nba',payloads,{status:'in_progress'},{now}),false);
 assert.equal(needsRecovery({...fresh,dataAsOf:'2026-11-05T15:00:00Z'},null,{now}),true);
});
