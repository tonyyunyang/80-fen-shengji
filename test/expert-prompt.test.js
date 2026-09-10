import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRequest,compactObservation} from '../src/providers.js';
import {observation,applyAction} from '../src/game.js';
import {choosePeilian} from '../src/peilian.js';
import {cardPlayFixture} from '../scripts/paired-eval.mjs';
import {expertPrompt} from '../src/expert-prompt.js';
const seat={provider:'qwen',model:'qwen3.8-flash'},env={QWEN_API_KEY:'fixture',QWEN_BASE_URL:'https://example.invalid/v1'};
test('Chinese and English comparisons change system language, not observation, moves or tool contract',()=>{
 let state=cardPlayFixture(842);
 for(let turn=0;turn<35&&state.pending;turn++){
  const d=state.pending,view=observation(state,d.seat);
  for(const prefix of ['expert','expert-facts','expert-search']) {
  const zh=buildRequest(view,seat,{env,contextProfile:prefix+'-zh'}),en=buildRequest(view,seat,{env,contextProfile:prefix+'-en'});
  assert.equal(zh.body.messages[1].content,en.body.messages[1].content);
  assert.deepEqual(zh.body.tools,en.body.tools);
  assert.deepEqual(zh.legalMoves,en.legalMoves);
  assert.notEqual(zh.body.messages[0].content,en.body.messages[0].content);
  }
  const payload=compactObservation(view,undefined,'expert-zh');
  assert.equal(payload.referenceAdvice,undefined);assert.equal(payload.endgameEstimates,undefined);
  assert.equal(payload.partnership.partner,(view.seat+2)%4);
  assert.equal(payload.seed,undefined);assert.equal(payload.hands,undefined);
  state=applyAction(state,{decisionId:d.id,version:d.version,seat:d.seat,action:choosePeilian(view)});
 }
 assert.equal(expertPrompt('zh').split('\n').length,expertPrompt('en').split('\n').length);
});

test('v16 expresses a secured defender feed as points banked by our team, not attacker gain or spending cost',()=>{
 const state=cardPlayFixture(842),base=observation(state,state.pending.seat);
 const c=(id,suit,rank)=>({id,suit,rank});
 const view={...base,phase:'follow',seat:3,myTeam:1,declSeat:1,dealer:1,dealerKnown:true,trump:{suit:'H',rank:2},hand:[c(8,'S',10),c(5,'S',7)],plays:[{seat:0,cards:[c(9,'S',11)]},{seat:1,cards:[c(10,'S',12)]},{seat:2,cards:[c(63,'S',11)]}],history:[],buriedKnown:[],declarations:[]};
 const zh=compactObservation(view,undefined,'expert-facts-zh'),en=compactObservation(view,undefined,'expert-facts-en');
 assert.deepEqual(zh,en);assert.equal(zh.v,16);assert.equal(zh.referenceAdvice,undefined);
 const ten=zh.expertFacts.moves.find(m=>m.card_ids.includes(8)),seven=zh.expertFacts.moves.find(m=>m.card_ids.includes(5));
 assert.equal(ten.teamOutcome,'secured');assert.equal(ten.pointsOurTeamSecures,10);assert.equal(seven.pointsOurTeamSecures,0);
 assert.equal(ten.pointsOpponentsSecure,null);
 assert.equal(zh.partnership.certainMoveOutcomes[ten.move_id].attackerPointsAddedNow,0);
 assert.equal(zh.expertFacts.moves.length,zh.legalMoves.length);
});
