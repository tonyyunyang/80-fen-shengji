import test from 'node:test';
import assert from 'node:assert/strict';
import {cardPlayFixture} from '../scripts/paired-eval.mjs';
import {observation,applyAction} from '../src/game.js';
import {choosePeilian} from '../src/peilian.js';
import {buildTeamContext} from '../src/team-context.js';
import {buildEndgameEstimates,sampleEndgamePositions,consistentFollows,rolloutEndgame} from '../src/endgame-estimates.js';
import {publicPlays} from '../src/notebook.js';
import {buildRequest,compactObservation,followMoves} from '../src/providers.js';
import {classify,followError} from '../src/rules.js';
const env={QWEN_API_KEY:'fixture-not-a-secret',QWEN_BASE_URL:'https://example.com/v1'};
function ending(seed){let state=cardPlayFixture(seed);while(Math.max(...state.hands.map(h=>h.length))>5){const d=state.pending;state=applyAction(state,{decisionId:d.id,version:state.version,seat:d.seat,action:choosePeilian(observation(state,d.seat))});}return state;}

test('partnership context identifies allies, enemies and the exact win threshold from every seat',()=>{
  for(let seat=0;seat<4;seat++){
    const state=ending(20261011),view=observation(state,seat),ctx=buildTeamContext(view);
    assert.equal(ctx.partner,(seat+2)%4);assert.ok(ctx.opponents.every(player=>player%2!==seat%2));
    assert.equal(ctx.seats[seat].relation,'you');assert.equal(ctx.seats[ctx.partner].relation,'partner');
    assert.equal(ctx.role,state.dealer%2===seat%2?'defend':'attack');assert.match(ctx.objective,/80/);
    assert.equal(buildTeamContext({...view,attackPoints:80}).scoreRace.takeoverAlreadySecured,true);
  }
});
test('sampled endgames conserve cards and obey public declarations, voids and all historical follows',()=>{
  for(const seed of [20261001,20261007,20261011,20261013]){
    const state=ending(seed),view=observation(state,state.pending.seat),samples=sampleEndgamePositions(view);
    assert.ok(samples.length>0,'feasible sample for '+seed);
    for(const sample of samples){
      const all=[...sample.hands.flat(),...sample.kitty,...publicPlays(view).flatMap(p=>p.cards)];
      assert.equal(all.length,108);assert.equal(new Set(all.map(c=>c.id)).size,108);
      assert.deepEqual(sample.hands.map(h=>h.length),view.handSizes);
      assert.deepEqual(sample.hands[view.seat],view.hand);
      assert.equal(consistentFollows(view,sample.hands),true);
      const played=new Set(publicPlays(view).flatMap(p=>p.cards).map(c=>c.id));
      for(const declaration of view.declarations)for(const card of declaration.cards){
        if(played.has(card.id))continue;
        assert.ok(sample.hands[declaration.seat].some(c=>c.id===card.id)||declaration.seat===view.declSeat&&sample.kitty.some(c=>c.id===card.id));
      }
    }
  }
});
test('endgame estimates are deterministic aggregates and never return the sampled private allocations',()=>{
  const state=ending(20261007),view=observation(state,state.pending.seat),moves=followMoves(view),result=buildEndgameEstimates(view,moves);
  assert.deepEqual(result,buildEndgameEstimates(view,moves));assert.ok(result.samples>0);
  assert.equal(JSON.stringify(result).includes('"hands"'),false);assert.equal(JSON.stringify(result).includes('"seed"'),false);assert.equal(JSON.stringify(result).includes('"kitty"'),false);
  const samples=sampleEndgamePositions(view);
  for(const candidate of result.candidates){
    const cards=candidate.cardIds.map(id=>view.hand.find(c=>c.id===id));assert.ok(cards.every(Boolean));
    if(view.phase==='follow')assert.equal(followError(view.hand,cards,classify(view.plays[0].cards,view.trump),view.trump,view.rules),null);
    else assert.notEqual(classify(cards,view.trump),null);
    assert.ok(candidate.sampledTeamWins>=0&&candidate.sampledTeamWins<=result.samples);
    for(const sample of samples)assert.ok(Number.isFinite(rolloutEndgame(sample,view.seat,cards).total));
  }
});
test('v8 requests ignore actual hidden hands, the unknown kitty, shuffle seeds and private quizzes',()=>{
  let state=ending(20261011);
  while(state.pending.seat===state.dealer){const d=state.pending;state=applyAction(state,{decisionId:d.id,version:state.version,seat:d.seat,action:choosePeilian(observation(state,d.seat))});}
  const actor=state.pending.seat,view=observation(state,actor),seat={provider:'qwen',model:'fixture-model'},options={env,contextProfile:'partnership'};
  const expected=buildRequest(view,seat,options);
  const hidden=structuredClone(state);hidden.seed=123456789;
  const others=[0,1,2,3].filter(s=>s!==actor&&hidden.hands[s].length);
  [hidden.hands[others[0]][0],hidden.kitty[0]]=[hidden.kitty[0],hidden.hands[others[0]][0]];
  const changed=observation(hidden,actor);changed.seed=555;changed.hands=hidden.hands;changed.unknownKitty=hidden.kitty;changed.quiz={secretAnswer:'do not send'};
  assert.deepEqual(buildRequest(changed,seat,options),expected);
  for(const contextProfile of ['expert-cooperate-zh','expert-cooperate-en','expert-cooperate-search-zh','expert-cooperate-search-en','expert-zh','expert-en','expert-facts-zh','expert-facts-en','expert-search-zh','expert-search-en','expert-search-wide-zh','search','partnership-plan','partnership-plan-search'])assert.deepEqual(buildRequest(changed,seat,{...options,contextProfile}),buildRequest(view,seat,{...options,contextProfile}));
  const compact=compactObservation(view,followMoves(view),'partnership');
  assert.equal(compact.v,8);assert.equal(compact.partnership.partner,(actor+2)%4);
  assert.equal(compact.referenceAdvice,undefined);assert.equal(compact.endgameEstimates,undefined);
  assert.match(expected.body.messages[0].content,/PARTNERSHIP winning/);
});

test('plan review preserves the full team context and keeps sampled estimates explicit and optional',()=>{
  const state=ending(20261007),view=observation(state,state.pending.seat),moves=followMoves(view);
  const ordinary=compactObservation(view,moves,'partnership'),plan=compactObservation(view,moves,'partnership-plan'),search=compactObservation(view,moves,'partnership-plan-search');
  assert.equal(plan.v,13);assert.equal(search.v,14);
  assert.deepEqual(plan.partnership,ordinary.partnership);assert.deepEqual(plan.legalMoves,ordinary.legalMoves);
  assert.ok(plan.referenceAdvice);assert.equal(plan.endgameEstimates,undefined);
  assert.ok(search.endgameEstimates?.samples);assert.equal(search.referenceAdvice.policy,'peilian');
  const request=buildRequest(view,{provider:'qwen',model:'fixture-model'},{env,contextProfile:'partnership-plan'});
  assert.match(request.body.messages[0].content,/copying it earns no reward/);
});
test('search never runs during bidding, burial or large-hand play',()=>{
  const view=observation(ending(20261001),0);
  for(const phase of ['declare','bury','rebel'])assert.equal(buildEndgameEstimates({...view,phase}),null);
  assert.equal(buildEndgameEstimates({...view,phase:'lead',handSizes:[25,25,25,25]}),null);
});

test('public last-seat facts distinguish feeding the point card that clinches the team win',async()=>{
  const {makeDeck}=await import('../src/cards.js');
  const {buildDecisionContext}=await import('../src/decision-context.js');
  const deck=makeDeck(),card=rank=>deck.find(c=>c.suit==='H'&&c.rank===rank);
  const view={seat:3,myTeam:1,declSeat:0,dealer:0,dealerKnown:true,trump:{suit:'D',rank:2},phase:'follow',hand:[card(5),card(3)],handSizes:[1,1,1,2],attackPoints:65,plays:[{seat:0,cards:[card(10)]},{seat:1,cards:[card(14)]},{seat:2,cards:[card(9)]}],rules:{strictTractorFollow:true,partialTractorFollow:true},buriedKnown:[]};
  const moves=[[card(5).id],[card(3).id]],facts=buildDecisionContext(view,moves,null),team=buildTeamContext(view,null,facts);
  assert.equal(team.partner,1);assert.equal(team.trick.winningRelation,'partner');
  assert.deepEqual(team.certainMoveOutcomes.map(m=>m.teamTrickOutcome),['secured','secured']);
  assert.deepEqual(team.certainMoveOutcomes.map(m=>m.clinchesAttackerTakeover),[true,false]);
  assert.deepEqual(team.certainMoveOutcomes.map(m=>m.attackerPointsAddedNow),[15,10]);
});

test('known declaration cards distinguish a nondealer holder from ambiguous dealer burial',()=>{
  const state=ending(20261001),view=observation(state,state.pending.seat),actor=view.seat,dealer=(actor+1)%4,partner=(actor+2)%4;
  const a={id:1000,suit:'S',rank:2},b={id:1001,suit:'H',rank:2};
  const source={...view,declSeat:dealer,dealer,declarations:[{seat:dealer,cards:[a]},{seat:partner,cards:[b]}]};
  const cards=buildTeamContext(source).unplayedRevealedCards;
  assert.equal(cards.find(row=>row.card[0]===1000).location,'dealer_hand_or_kitty');
  assert.equal(cards.find(row=>row.card[0]===1001).location,'hand');
  assert.equal(cards.find(row=>row.card[0]===1001).relation,'partner');
});

test('optional advice adds a candidate without dropping team facts or rewarding imitation',()=>{
  const state=ending(20261011),view=observation(state,state.pending.seat),request=buildRequest(view,{provider:'qwen',model:'fixture-model'},{env,contextProfile:'partnership-advised'});
  const input=JSON.parse(request.body.messages[1].content);
  assert.equal(input.v,10);assert.equal(input.partnership.partner,(view.seat+2)%4);assert.ok(input.referenceAdvice);assert.equal(input.endgameEstimates,undefined);
  assert.match(request.body.messages[0].content,/Agreement is not rewarded/);
  assert.equal(request.body.messages[0].content.includes('Prefer it unless'),false);
});


test('earlier sampled analysis remains bounded and uses only consistent hypothetical allocations',()=>{
  let state=cardPlayFixture(22019);
  while(Math.max(...state.hands.map(h=>h.length))>12){const d=state.pending;state=applyAction(state,{decisionId:d.id,version:d.version,seat:d.seat,action:choosePeilian(observation(state,d.seat),d.id)});}
  const view=observation(state,state.pending.seat),moves=followMoves(view),request=compactObservation(view,moves,'expert-search-zh');
  assert.equal(request.v,17);assert.equal(request.referenceAdvice,undefined);
  assert.ok(request.endgameEstimates.samples>0&&request.endgameEstimates.samples<=8);
  assert.equal(JSON.stringify(request.endgameEstimates).includes('"hands"'),false);
  assert.equal(compactObservation({...view,phase:'bury'},null,'expert-search-zh').endgameEstimates,null);
});
