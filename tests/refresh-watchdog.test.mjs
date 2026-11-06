import test from 'node:test';
import assert from 'node:assert/strict';
import {needsRecovery} from '../scripts/refresh-watchdog.mjs';
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
