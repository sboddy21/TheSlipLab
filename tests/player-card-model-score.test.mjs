import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../website/player_card_patch.js',import.meta.url),'utf8');

test('expanded MLB card labels the published confidence value as a score, not a probability',()=>{
  assert.ok(source.includes('Model HR score / 100'));
  assert.ok(source.includes('row.rawModelConfidence ?? row.hrConfidence ?? row.score'));
  assert.ok(!source.includes('<span>Model HR estimate</span>'));
});
