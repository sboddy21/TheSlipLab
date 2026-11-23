import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function client() {
 const elements = new Map();
 const replies = [];
 const document = {
  getElementById: id => elements.get(id),
  createElement: () => ({style:{},setAttribute(){},remove(){elements.delete(this.id);}}),
  body:{appendChild(node){elements.set(node.id,node);}}
 };
 const window = {location:{href:'https://example.com/nba.html',origin:'https://example.com'},TSLAccount:{ready:Promise.resolve(),accessToken:async()=>''},fetch:async()=>{
  const reply=replies.shift(); if(reply instanceof Error)throw reply; return reply;
 },setTimeout: fn=>{fn();}};
 vm.runInNewContext(fs.readFileSync('website/assets/member-data.js','utf8'),{window,document,Request,Headers,URL,setTimeout});
 return {replies,fetch:window.fetch,notice:()=>elements.get('tslDataUnavailable')?.textContent};
}
const response=(status=200,freshness='current')=>({status,ok:status===200,headers:new Headers({'X-Data-Freshness':freshness})});
test('delayed feed remains visible until that same feed recovers',async()=>{
 const c=client();
 c.replies.push(response(200,'delayed'));await c.fetch('/data/nba_points.json');
 assert.match(c.notice(),/DELAYED DATA/);
 c.replies.push(response());await c.fetch('/data/nba_rebounds.json');
 assert.match(c.notice(),/nba points/);
 c.replies.push(response());await c.fetch('/data/nba_points.json');
 assert.equal(c.notice(),undefined);
});
test('unavailable and network failures are visible without consuming responses',async()=>{
 const c=client(), failed=response(503);
 c.replies.push(failed,failed);assert.equal(await c.fetch('/data/nba_points.json'),failed);
 assert.match(c.notice(),/DATA UNAVAILABLE/);
 c.replies.push(new Error('offline'));await assert.rejects(c.fetch('/data/nba_rebounds.json'),/offline/);
 assert.match(c.notice(),/nba rebounds/);
});
