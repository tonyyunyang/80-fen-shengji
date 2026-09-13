import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDeck} from '../src/cards.js';
import {DEFAULT_RULES,resolveTrick} from '../src/rules.js';
import {compactObservation,buildRequest,followMoves} from '../src/providers.js';
import {observation,applyAction,createGame} from '../src/game.js';
import {cardPlayFixture} from '../scripts/paired-eval.mjs';
import {choosePeilian} from '../src/peilian.js';
import {cooperationCases} from './fixtures/cooperation-cases.mjs';
import {runCooperationEvaluation} from '../scripts/cooperation-eval.mjs';
import {Session,validateConfig} from '../server/session.js';

const deck=makeDeck(),c=(s,r,copy=0)=>deck.find(c=>c.suit===s&&c.rank===r&&Math.floor(c.id/54)===copy);
const base={schemaVersion:1,ruleset:'fixture',seat:0,myTeam:0,phase:'follow',trump:{suit:'C',rank:2},trumpRank:2,
  hand:[],handSizes:[3,3,2,2],history:[],plays:[],buriedKnown:[],declarations:[],declSeat:0,dealer:0,dealerKnown:true,
  levels:[2,2],played:[-1,-1],gates:[],rules:{...DEFAULT_RULES,gates:[]},attackPoints:0};
const context=view=>compactObservation(view,undefined,'expert-cooperate-zh');
const move=(data,ids)=>data.expertFacts.moves.find(row=>row.card_ids.length===ids.length&&ids.every(id=>row.card_ids.includes(id)));

test('feed a proven partner winner before a remaining opponent, retaining the equal top joker',()=>{
  const view={...base,hand:[c('X',16,1),c('C',5),c('C',6)],plays:[{seat:2,cards:[c('X',16)]},{seat:3,cards:[c('C',3)]}]};
  const old=compactObservation(view,undefined,'expert-facts-zh'),next=context(view);
  assert.ok(old.expertFacts.moves.every(m=>m.teamOutcome==='unsettled'));
  assert.ok(next.expertFacts.moves.every(m=>m.teamOutcome==='secured'));
  const five=move(next,[c('C',5).id]),joker=move(next,[c('X',16,1).id]),six=move(next,[c('C',6).id]);
  assert.deepEqual(next.cooperation.comparisons.safePointCarrying,[five.move_id]);
  assert.equal(five.pointsOurTeamSecures,5);assert.equal(five.pointsOpponentsSecure,null);
  assert.ok(joker.cheaperSameOutcome.includes(six.move_id));
  assert.equal(joker.winningSeat,2,'equal-order cards do not overtake the earlier winner');
});
test('side-suit ace is only provisional when an opponent can ruff; a zero-point trick does not demand an expensive cover',()=>{
  const view={...base,hand:[c('X',16),c('D',10),c('D',3)],
    history:[{seat:0,cards:[c('S',6)]},{seat:1,cards:[c('H',4)]},{seat:2,cards:[c('S',9)]},{seat:3,cards:[c('S',8)]}],
    plays:[{seat:2,cards:[c('S',14)]},{seat:3,cards:[c('S',7)]}]};
  const data=context(view),ten=move(data,[c('D',10).id]),three=move(data,[c('D',3).id]),joker=move(data,[c('X',16).id]);
  assert.equal(data.cooperation.trick.partnerControl,'unsettled');
  assert.equal(data.cooperation.trick.threats[0].provenVoidInLedSuit,true);
  assert.equal(ten.teamOutcome,'unsettled');assert.equal(ten.pointsOurTeamSecures,null);
  assert.deepEqual(data.cooperation.comparisons.safePointCarrying,[]);
  assert.deepEqual(data.cooperation.comparisons.economicalPartnerSupport,[three.move_id]);
  assert.deepEqual(data.cooperation.comparisons.guaranteedProtection,[joker.move_id]);
  assert.equal(data.cooperation.plan.currentPriority,'economical_support_no_automatic_expensive_cover');
});
test('a secured feed banks defender points while preserving an ace entry',()=>{
  const view={...base,seat:3,myTeam:1,declSeat:1,dealer:1,hand:[c('S',5),c('S',10),c('S',14)],
    plays:[{seat:0,cards:[c('S',9)]},{seat:1,cards:[c('S',12)]},{seat:2,cards:[c('S',11)]}]};
  const data=context(view),ten=move(data,[c('S',10).id]);
  assert.deepEqual(data.cooperation.comparisons.safePointCarrying,[ten.move_id]);
  assert.equal(ten.pointsOurTeamSecures,10);assert.equal(data.partnership.role,'defend');
  assert.equal(data.partnership.certainMoveOutcomes[ten.move_id].attackerPointsAddedNow,0);
});
test('a cover that locks the 80-point threshold takes priority over saving its high trump',()=>{
  const view={...base,declSeat:1,dealer:1,attackPoints:70,hand:[c('X',16),c('D',3),c('D',10)],
    plays:[{seat:2,cards:[c('S',14)]},{seat:3,cards:[c('S',13)]}]};
  const data=context(view),joker=move(data,[c('X',16).id]);
  assert.equal(joker.teamOutcome,'secured');assert.equal(joker.visiblePoints,10);
  assert.deepEqual(data.cooperation.comparisons.clinchesAttackWin,[joker.move_id]);
  assert.equal(data.cooperation.plan.currentPriority,'secure_the_80_point_win');
});
test('pair and tractor control require matching structures, with an earlier top structure remaining unbeatable',()=>{
  for(const tractor of [false,true]){
    const lead=tractor?[c('X',15),c('X',15,1),c('X',16),c('X',16,1)]:[c('X',16),c('X',16,1)];
    const low=tractor?[c('C',5),c('C',5,1),c('C',6),c('C',6,1)]:[c('C',5),c('C',5,1)];
    const high=tractor?[c('H',2),c('H',2,1),c('C',2),c('C',2,1)]:[c('H',2),c('H',2,1)];
    const enemy=tractor?[c('C',3),c('C',3,1),c('C',4),c('C',4,1)]:[c('C',3),c('C',3,1)];
    const data=context({...base,hand:[...low,...high],handSizes:[low.length*2,low.length*2,low.length,low.length],plays:[{seat:2,cards:lead},{seat:3,cards:enemy}]});
    const feed=move(data,low.map(c=>c.id));assert.equal(feed.teamOutcome,'secured');assert.equal(feed.pointsOurTeamSecures,10);
    assert.deepEqual(data.cooperation.comparisons.safePointCarrying,[feed.move_id]);
  }
});
test('known nondealer cards constrain possible counters, without treating a dealer declaration as a known hand',()=>{
  const view={...base,trump:{suit:'S',rank:2},handSizes:[2,2,1,1],hand:[c('S',5),c('S',6)],
    plays:[{seat:2,cards:[c('X',15)]},{seat:3,cards:[c('S',3)]}],declarations:[{seat:1,cards:[c('S',2),c('S',2,1)]}]};
  assert.equal(context(view).cooperation.trick.partnerControl,'secured');
  assert.equal(context({...view,declSeat:1,dealer:1}).cooperation.trick.partnerControl,'unsettled','those declared cards could have been buried by the dealer');
});
test('Chinese and English retain the full legal menu and identical facts; old profiles stay separate',()=>{
  const state=cardPlayFixture(7129),view=observation(state,state.pending.seat),seat={provider:'qwen',model:'qwen3.8-max'},env={QWEN_API_KEY:'fixture',QWEN_BASE_URL:'https://example.invalid/v1'};
  const zh=buildRequest(view,seat,{env,contextProfile:'expert-cooperate-zh'}),en=buildRequest(view,seat,{env,contextProfile:'expert-cooperate-en'});
  assert.equal(zh.body.messages[1].content,en.body.messages[1].content);assert.deepEqual(zh.body.tools,en.body.tools);
  assert.notEqual(zh.body.messages[0].content,en.body.messages[0].content);
  assert.equal(compactObservation(view,undefined,'expert-facts-zh').cooperation,undefined);
  assert.equal(JSON.parse(zh.body.messages[1].content).v,19);
  assert.deepEqual(zh.legalMoves,followMoves(view));
});
test('cooperation facts are invariant to real hidden hands, seed and unknown burial',()=>{
  for(const seed of [7129,7133,7141]){
    let state=cardPlayFixture(seed);
    for(let i=0;i<40&&state.pending;i++){
      const d=state.pending,view=observation(state,d.seat),altered=structuredClone(state);
      altered.seed+=999;altered.quiz={answer:'private'};
      if(d.seat!==state.dealer&&altered.hands[(d.seat+1)%4].length){[altered.hands[(d.seat+1)%4][0],altered.kitty[0]]=[altered.kitty[0],altered.hands[(d.seat+1)%4][0]];}
      assert.deepEqual(context(view),context(observation(altered,d.seat)));
      const next=context(view);
      if(view.phase==='follow'&&next.expertFacts.moves){
        const observed=resolveTrick(view.plays,view.trump).winner;
        assert.equal(next.cooperation.trick.winningSeat,observed);
      }
      state=applyAction(state,{decisionId:d.id,version:d.version,seat:d.seat,action:choosePeilian(view,d.id)});
    }
  }
});

test('predeclared tactical answers are legal and evaluator keeps errors in the denominator',async()=>{
  for(const item of cooperationCases()){
    const moves=followMoves(item.view);assert.ok(moves?.length);
    for(const ids of item.accept)assert.ok(moves.some(move=>move.length===ids.length&&ids.every(id=>move.includes(id))),item.id);
  }
  await assert.rejects(runCooperationEvaluation(),/explicit live/);
  const report=await runCooperationEvaluation({live:true,env:{QWEN_API_KEY:'fixture',QWEN_BASE_URL:'https://example.invalid/v1'},call:async()=>{throw new Error('offline failure');}});
  assert.equal(report.requests.length,48);assert.ok(report.summary.every(row=>row.passed===0&&row.failed===24));
});

test('secured and lost deductions hold against every legal last-seat reply in seeded deals',()=>{
  let checked=0;
  for(const seed of [7217,7229,7237]){
    let state=cardPlayFixture(seed);
    while(state.pending){
      const d=state.pending,view=observation(state,d.seat),data=context(view);
      if(view.plays.length===2&&data.expertFacts.moves){
        for(const row of data.expertFacts.moves.filter(m=>m.teamOutcome!=='unsettled')){
          const advanced=applyAction(state,{decisionId:d.id,version:d.version,seat:d.seat,action:{type:'play',cardIds:row.card_ids}});
          const next=observation(advanced,advanced.pending.seat),replies=followMoves(next);
          if(!replies)continue;
          for(const ids of replies){
            const winner=resolveTrick([...advanced.plays,{seat:next.seat,cards:next.hand.filter(c=>ids.includes(c.id))}],view.trump).winner;
            assert.equal(winner%2===view.seat%2,row.teamOutcome==='secured',seed+':'+d.id);checked++;
          }
        }
      }
      state=applyAction(state,{decisionId:d.id,version:d.version,seat:d.seat,action:choosePeilian(view,d.id,{deterministic:true})});
    }
  }
  assert.ok(checked>=100,checked+' concrete legal replies checked');
});

test('inconsistent revealed-card evidence stays uncertain, and oversized menus keep direct card IDs',()=>{
  const view={...base,trump:{suit:'S',rank:2},handSizes:[2,2,1,1],hand:[c('S',5),c('S',6)],
    plays:[{seat:2,cards:[c('X',15)]},{seat:3,cards:[c('S',3)]}],declarations:[{seat:1,cards:[c('S',2),c('S',2,1)]}],
    history:[{seat:0,cards:[c('X',16)]},{seat:1,cards:[c('H',4)]},{seat:2,cards:[c('S',7)]},{seat:3,cards:[c('S',8)]}]};
  assert.equal(context(view).cooperation.trick.partnerControl,'unsettled');
  const large={...base,hand:[...deck.filter(c=>c.suit==='C'&&c.id<54),c('H',2),c('D',2),c('S',2),c('X',15)],handSizes:[17,17,15,15],
    plays:[{seat:2,cards:[c('X',16),c('X',16,1)]},{seat:3,cards:[c('S',6),c('S',6,1)]}]};
  assert.equal(followMoves(large),null);
  const request=buildRequest(large,{provider:'qwen',model:'fixture'},{env:{QWEN_API_KEY:'fixture',QWEN_BASE_URL:'https://example.invalid/v1'},contextProfile:'expert-cooperate-zh'});
  assert.equal(request.body.tools[0].function.name,'play_cards');
  assert.equal(JSON.parse(request.body.messages[1].content).expertFacts.moves,null);
});

test('runtime upgrades card play while preserving declaration, redeal and burial profiles',async()=>{
  const seen=new Set(),session=new Session({env:{QWEN_API_KEY:'fixture',QWEN_BASE_URL:'https://example.invalid/v1'},providerCall:async(view,seat,options)=>{
    seen.add(view.phase);
    assert.equal(options.contextProfile,['lead','follow'].includes(view.phase)?'expert-cooperate-zh':'expert-facts-zh');
    return {action:choosePeilian(view,options.decisionId,{deterministic:true}),usage:{input:0,output:0,cached:0,cacheWrite:0},ms:0,simulated:true};
  }});
  session.config=validateConfig({dealing:'ordered',seats:Array.from({length:4},()=>({kind:'api',provider:'qwen',model:'fixture',endgameAnalysis:false}))},{qwen:true});
  session.state=createGame({...session.config,seed:8171});session.schedule=()=>{};
  try{for(let i=0;i<400&&session.state.pending&&!seen.has('follow');i++)await session.step();}finally{session.stop();}
  for(const phase of ['declare','bury','lead','follow'])assert.ok(seen.has(phase),phase);
});
