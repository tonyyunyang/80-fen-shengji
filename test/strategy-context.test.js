import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck } from '../src/cards.js';
import { createGame, observation, applyAction } from '../src/game.js';
import { choosePeilian } from '../src/peilian.js';
import { buildNotebook } from '../src/notebook.js';
import { buildStrategyContext } from '../src/strategy-context.js';
import { compactObservation, followMoves, buildRequest, STRATEGIC_PROMPT } from '../src/providers.js';

const deck = makeDeck();
const c = (suit, rank, copy = 0) => deck.find(card => card.suit === suit && card.rank === rank && Math.floor(card.id / 54) === copy);
const base = { phase: 'follow', seat: 0, trump: { suit: 'C', rank: 2 }, declSeat: 0, dealer: 0,
  hand: [], history: [], plays: [], buriedKnown: [], declarations: [], handSizes: [5,5,5,5], rules: {}, attackPoints: 20 };
function context(view) { return buildStrategyContext(view, followMoves(view), buildNotebook(view)); }

test('a structurally lost trick is identified without knowing the last opponent hand', () => {
  const view = { ...base, hand: [c('H',2),c('C',12),c('C',10)],
    plays: [{ seat:2,cards:[c('C',3),c('C',3,1)] },{ seat:3,cards:[c('C',14),c('C',14,1)] }] };
  const result = context(view);
  assert.equal(result.table.allLegalMovesLose, true);
  assert.ok(result.moves.every(move => move.teamOutcome === 'lost'));
  const moves = followMoves(view), preservesLevel = result.moves.find(move => !moves[move.id].includes(c('H',2).id));
  assert.equal(preservesLevel.highTrumpsSpent, 0);
  assert.equal(preservesLevel.pointsSpent, 10);
  assert.deepEqual(result.comparisonSets.leastHighTrumpsSpent, [preservesLevel.id]);
  assert.match(result.brief, /cannot recover this trick/);
  assert.ok(preservesLevel.cards.includes('Q'));
  assert.ok(result.moves.some(move => move.pointsSpent === 0 && move.highTrumpsSpent === 1));
});
test('a last-seat win exposes bankable points while an earlier provisional win stays unsettled', () => {
  const hand = [c('C',4),c('C',5)];
  const view = { ...base, hand, plays: [{seat:1,cards:[c('D',13)]},{seat:2,cards:[c('D',5)]},{seat:3,cards:[c('D',14)]}] };
  const result = context(view);
  assert.ok(result.moves.every(move => move.teamOutcome === 'secured'));
  assert.deepEqual(result.moves.map(move => move.visiblePointsAfterMove).sort((a,b)=>a-b), [15,20]);
  assert.equal(result.comparisonSets.mostVisiblePointsWhenSecured.length, 1);
  const earlier = context({...view,seat:2,plays:view.plays.slice(0,1)});
  assert.ok(earlier.moves.every(move => move.teamOutcome === 'unsettled'));
});
test('public declarations locate nondealer cards but preserve dealer/kitty ambiguity', () => {
  const view = {...base,phase:'lead',seat:1,hand:[c('S',7)],declSeat:0,
    declarations:[{seat:0,cards:[c('C',2)]},{seat:2,cards:[c('H',2)]},{seat:2,cards:[c('H',2),c('H',2,1)]}]};
  const result=context(view);
  assert.equal(result.publicDeclarationCards.length,3);
  assert.equal(result.publicDeclarationCards.find(x=>x.seat===0).location,'dealer-hand-or-kitty');
  assert.ok(result.publicDeclarationCards.filter(x=>x.seat===2).every(x=>x.location==='hand'));
  const played=context({...view,history:[{seat:2,cards:[c('H',2)]}]});
  assert.equal(played.publicDeclarationCards.some(x=>x.card[0]===c('H',2).id),false);
  const own=context({...view,seat:0,hand:[c('C',2)],buriedKnown:[c('D',5)]});
  assert.equal(own.publicDeclarationCards.find(x=>x.seat===0).location,'hand');
});
test('v5 adds explicit resource facts without changing the complete menu or v4 baseline', () => {
  const view={...base,hand:[c('S',3),c('S',5),c('S',13)],plays:[{seat:3,cards:[c('S',7)]}]};
  const old=compactObservation(view,undefined,'tactical'), next=compactObservation(view,undefined,'strategic');
  assert.equal(old.v,4); assert.equal(next.v,5);
  assert.deepEqual(old.legalMoves,next.legalMoves);
  assert.equal(old.decisionContext.version,1); assert.equal(next.decisionContext.version,2);
  assert.deepEqual(next.decisionContext.moves.map(move=>move.id),next.legalMoves.map(move=>move.id));
  const env={QWEN_API_KEY:'fixture-only',QWEN_BASE_URL:'https://example.invalid/v1'};
  const request=buildRequest(view,{provider:'qwen',model:'fixture'},{env,contextProfile:'strategic'});
  assert.ok(request.body.messages[0].content.includes(STRATEGIC_PROMPT));
  assert.equal(JSON.stringify(request.body).includes('fixture-only'),false);
});
test('strategy facts and prompt stay invariant under hidden hands, kitty, seeds and quiz changes', () => {
  for(const seed of [501,607,709,811,919,1021]){
    let state=createGame({seed,dealing:'ordered',seats:Array.from({length:4},()=>({kind:'peilian'}))});
    while(state.pending?.phase!=='follow'||state.pending.seat===state.dealer){const d=state.pending;state=applyAction(state,{decisionId:d.id,version:d.version,seat:d.seat,action:choosePeilian(observation(state,d.seat),d.id,{deterministic:true})});}
    const seat=state.pending.seat,other=(seat+1)%4, altered=structuredClone(state);
    [altered.hands[other][0],altered.kitty[0]]=[altered.kitty[0],altered.hands[other][0]];
    altered.seed+=101;altered.quiz={answer:'never provider context'};
    const before=observation(state,seat),after=observation(altered,seat);
    assert.deepEqual(compactObservation(before,undefined,'strategic'),compactObservation(after,undefined,'strategic'));
  }
});
