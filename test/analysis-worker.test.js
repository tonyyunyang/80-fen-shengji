import test from 'node:test';import assert from 'node:assert/strict';
import {analyzeEndgame} from '../src/analysis-worker.js';import {cardPlayFixture} from '../scripts/paired-eval.mjs';import {observation,applyAction} from '../src/game.js';import {choosePeilian} from '../src/peilian.js';import {followMoves} from '../src/providers.js';
test('private sampled work leaves the event loop responsive and does not build an unbounded queue',async()=>{
 let s=cardPlayFixture(22019);while(Math.max(...s.hands.map(h=>h.length))>12){const d=s.pending;s=applyAction(s,{decisionId:d.id,version:d.version,seat:d.seat,action:choosePeilian(observation(s,d.seat),d.id)});}
 const v=observation(s,s.pending.seat),moves=followMoves(v);let ticks=0;const timer=setInterval(()=>ticks++,5);
 const first=analyzeEndgame(v,moves);const second=await analyzeEndgame(v,moves);assert.equal(second.status,'busy');
 const r=await first;clearInterval(timer);assert.ok(ticks>0);assert.ok(['complete','budget'].includes(r.status));
 if(r.value){assert.ok(r.value.samples<=8);assert.equal(JSON.stringify(r.value).includes('"hands"'),false);}
 assert.equal((await analyzeEndgame({...v,phase:'declare'},null)).status,'not_needed');
});
