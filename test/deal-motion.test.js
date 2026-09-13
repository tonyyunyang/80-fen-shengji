import test from 'node:test';
import assert from 'node:assert/strict';
import {DealFlow} from '../public/deal-motion.js';
import {isPlayIntent} from '../public/play-intent.js';
const game=(dealt,extra={})=>({id:'fixture',viewer:0,dealing:'continuous',phase:'dealing',dealt,drawSeat:dealt%4,events:[{type:'deal_started',seq:0}],...extra});
test('public declarations and repainting cannot restart a flight; no historical animation backlog',()=>{
  const f=new DealFlow();assert.equal(f.update(game(38),true),null);
  const cue=f.update(game(39),true);assert.ok(cue);
  assert.equal(f.update(game(39,{events:[{type:'deal_started',seq:0},{type:'declaration',seq:40}]}),true),null);
  assert.equal(f.update(game(39),true),null);
  assert.equal(f.update(game(80),true).key,'fixture:0:0:80','batched state triggers only its latest draw');
  assert.equal(f.update(game(80),false),null);assert.equal(f.update(game(90),true),null);
  assert.equal(f.update(game(0,{id:'new'}),true),null);
  assert.ok(f.update(game(1,{id:'new'}),true));
  assert.equal(f.update(game(100,{phase:'play'}),true),null);
});
test('play intent accepts a lifted card across the hand edge anywhere on the felt, not a fingertip target',()=>{
  const card={left:32,top:550,width:96,height:144},field={left:16,right:374,top:90,bottom:515};
  assert.equal(isPlayIntent(card,0,-40,field),true,'front edge enters while fingertip can remain near the hand');
  assert.equal(isPlayIntent(card,235,-40,field),true,'right side of felt works too');
  assert.equal(isPlayIntent(card,0,-12,field),false,'a click or small wobble is not a play');
  assert.equal(isPlayIntent(card,150,0,field),false,'horizontal swipe is not a play');
  assert.equal(isPlayIntent(card,0,20,field),false,'returning into the hand cancels');
  assert.equal(isPlayIntent(card,-100,-100,field),false,'outside table');
  assert.equal(isPlayIntent(card,0,-600,field),false,'above the playing surface');
});
