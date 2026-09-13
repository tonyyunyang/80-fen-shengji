import test from 'node:test';
import assert from 'node:assert/strict';
import {compactObservation,followMoves,buildRequest} from '../src/providers.js';
import {packetReferenceChance} from '../src/partnership-read.js';
import {partnershipReadCases,card} from './fixtures/partnership-read-cases.mjs';
import {cardPlayFixture} from '../scripts/paired-eval.mjs';
import {observation,applyAction} from '../src/game.js';
import {choosePeilian} from '../src/peilian.js';

const payload=view=>compactObservation(view,undefined,'expert-read-zh');
test('reference probabilities match exhaustive small combinations with fixed and excluded cards',()=>{
  for(let n=1;n<=8;n++)for(let k=0;k<=n;k++)for(let fixed=0;fixed<=Math.min(2,k);fixed++)for(let absent=0;absent<=n-fixed;absent++){
    let total=0,valid=0;
    for(let mask=0;mask<2**n;mask++)if(mask.toString(2).replaceAll('0','').length===k){
      total++;if(Array.from({length:fixed},(_,i)=>!!(mask&2**i)).every(Boolean)&&Array.from({length:absent},(_,i)=>!(mask&2**(fixed+i))).every(Boolean))valid++;
    }
    assert.ok(Math.abs(packetReferenceChance(n,k,fixed,absent)-valid/total)<1e-10);
  }
});
test('early side masters expose a low-risk feed window without falsely becoming proven winners',()=>{
  for(const item of partnershipReadCases().filter(c=>/early-|established-|side-ace-pair|overcalled/.test(c.id))){
    const next=payload(item.view),old=compactObservation(item.view,undefined,'expert-cooperate-zh'),read=next.partnershipRead;
    assert.equal(read.trick.partnerWindow,'low_reference_risk',item.id);
    assert.ok(read.trick.counters.every(c=>c.referenceMustFollow>.96));
    assert.ok(read.preferredPointFeeds.some(id=>item.accept.some(ids=>ids.length===next.expertFacts.moves[id].card_ids.length&&ids.every(c=>next.expertFacts.moves[id].card_ids.includes(c)))));
    assert.equal(next.cooperation.trick.partnerControl,'unsettled');
    assert.deepEqual(next.partnership.certainMoveOutcomes,old.partnership.certainMoveOutcomes);
    assert.deepEqual(next.legalMoves,old.legalMoves);
  }
});
test('known voids and larger ranks block blind feeds; inconsistent public counts suppress estimates',()=>{
  for(const item of partnershipReadCases().filter(c=>/queen-|proven-void|small-joker/.test(c.id))){
    const read=payload(item.view).partnershipRead;
    assert.equal(read.trick.partnerWindow,'uncertain',item.id);assert.deepEqual(read.preferredPointFeeds,[]);
  }
  const view=partnershipReadCases([0])[0].view;view.handSizes[1]--;
  const read=payload(view).partnershipRead;
  assert.equal(read.trick.referenceCounterRisk,null);assert.deepEqual(read.preferredPointFeeds,[]);
});
test('accepted bid history survives overcalls and tracks exposed cards after they are played',()=>{
  const view=partnershipReadCases([0]).find(c=>c.id.startsWith('overcalled')).view;
  const bids=payload(view).partnershipRead.declarations;
  assert.equal(bids.length,2);assert.equal(bids[0].superseded,true);assert.equal(bids[0].shown[0].location,'revealing_players_hand');
  assert.equal(bids[1].shown[0].location,'your_hand');
  view.history=[{seat:1,cards:[card('H',2)]},{seat:2,cards:[card('H',3)]},{seat:3,cards:[card('H',4)]},{seat:0,cards:[card('H',5)]}];
  const remembered=payload(view).partnershipRead.declarations[0];assert.equal(remembered.shown[0].location,'played');assert.equal(remembered.shown[0].playedBy,1);
  const dealerVersion=payload({...view,history:[],declSeat:1,dealer:1}).partnershipRead.declarations[0];
  assert.equal(dealerVersion.shown[0].location,'dealer_hand_or_kitty');
});
test('new bilingual observations are identical and remain invariant to real hidden hands',()=>{
  let state=cardPlayFixture(901771);
  for(let i=0;i<50&&state.pending;i++){
    const d=state.pending,view=observation(state,d.seat),changed=structuredClone(view);
    changed.hands=state.hands;changed.seed=state.seed;changed.unknownKitty=state.kitty;changed.quiz={answer:'private'};
    assert.deepEqual(payload(changed),payload(view));
    assert.deepEqual(payload(view),compactObservation(view,undefined,'expert-read-en'));
    state=applyAction(state,{decisionId:d.id,version:d.version,seat:d.seat,action:choosePeilian(view,d.id,{deterministic:true})});
  }
  const item=partnershipReadCases([0])[0],seat={provider:'qwen',model:'fixture'},env={QWEN_API_KEY:'fixture',QWEN_BASE_URL:'https://example.invalid/v1'};
  const zh=buildRequest(item.view,seat,{env,contextProfile:'expert-read-zh'}),en=buildRequest(item.view,seat,{env,contextProfile:'expert-read-en'});
  assert.deepEqual(zh.body.tools,en.body.tools);assert.equal(zh.body.messages[1].content,en.body.messages[1].content);
  assert.match(zh.body.messages[0].content,/本次跑分窗口/);assert.equal(payload(item.view).v,21);
});
