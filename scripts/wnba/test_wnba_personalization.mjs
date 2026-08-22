import assert from "node:assert/strict";
await import("../../website/assets/wnba-personalization-core.js");
const rows=[{playerId:"1",team:"NY"},{playerId:"2",team:"CON"}];
const favorites=[{sport:"WNBA",entity_type:"player",external_id:"1"},{sport:"WNBA",entity_type:"team",external_id:"CON"},{sport:"MLB",entity_type:"player",external_id:"2"}];
assert.deepEqual(globalThis.TSLWnbaPersonalization.filterRows(rows,favorites),rows);
assert.equal(globalThis.TSLWnbaPersonalization.find(favorites,"player","1").external_id,"1");
assert.equal(globalThis.TSLWnbaPersonalization.find(favorites,"player","2"),undefined);
console.log("WNBA PERSONALIZATION TEST PASSED");
