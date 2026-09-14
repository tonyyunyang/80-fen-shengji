import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck, points } from '../src/cards.js';
import { resolveTrick, DEFAULT_RULES } from '../src/rules.js';
import { buildTrickAudit, kittyPointBounds } from '../src/trick-audit.js';
import { buildRequest, compactObservation, followMoves } from '../src/providers.js';
import { observation, applyAction } from '../src/game.js';
import { choosePeilian } from '../src/peilian.js';
import { cardPlayFixture } from '../scripts/paired-eval.mjs';

const deck = makeDeck();
const c = (suit, rank, copy = 0) => deck.filter(c => c.suit === suit && c.rank === rank)[copy];
const base = { seat: 1, myTeam: 1, phase: 'follow', declSeat: 0, dealer: 0, dealerKnown: true,
  trump: { suit: 'H', rank: 2 }, rules: DEFAULT_RULES, attackPoints: 0, handSizes: [24,25,25,25],
  hand: [], plays: [], history: [], declarations: [], buriedKnown: [], levels: [2,2], played: [1,1], gates: DEFAULT_RULES.gates };

test('earlier equal wins in the engine and model facts, independently of physical ID order', () => {
  const examples = [
    [[c('S',14)], [c('S',14,1)], base.trump],
    [[c('S',14,1)], [c('S',14)], base.trump],
    [[c('H',2)], [c('H',2,1)], base.trump],
    [[c('S',2)], [c('D',2)], base.trump],
    [[c('X',16)], [c('X',16,1)], base.trump],
    [[c('X',15,1)], [c('X',15)], base.trump],
    [[c('S',2),c('S',2,1)], [c('D',2),c('D',2,1)], base.trump],
    [[c('H',2)], [c('S',2)], {suit:null,rank:2}],
  ];
  for (const [earlier, later, trump] of examples) {
    const view = {...base, trump, plays:[{seat:0,cards:earlier}], hand:later};
    const moves = [later.map(c=>c.id)], info = buildTrickAudit(view,moves);
    assert.equal(resolveTrick([...view.plays,{seat:1,cards:later}],trump).winner,0);
    assert.deepEqual(info.equalStrengthMoveIds,[0]);
    const compact = compactObservation(view,moves,'expert-audit-zh');
    assert.equal(compact.decisionContext.moves[0].winnerSoFar,0);
  }
});

test('a higher trump wins, while an off-suit or mismatched structure is never labelled an equal contender', () => {
  for (const [lead,hand,expected] of [
    [[c('S',14)],[c('H',14)],1],
    [[c('S',14)],[c('D',14)],0],
    [[c('S',2),c('S',2,1)],[c('D',2),c('C',2)],0],
  ]) {
    const view={...base,plays:[{seat:0,cards:lead}],hand};
    assert.deepEqual(buildTrickAudit(view,[hand.map(c=>c.id)]).equalStrengthMoveIds,[]);
    assert.equal(resolveTrick([...view.plays,{seat:1,cards:hand}],view.trump).winner,expected);
  }
});

test('current bilingual requests separate history from this trick without changing the legal action menu', () => {
  let state=cardPlayFixture(91402);
  for(let i=0;i<6;i++){const d=state.pending;state=applyAction(state,{decisionId:d.id,version:d.version,seat:d.seat,action:choosePeilian(observation(state,d.seat))});}
  const view=observation(state,state.pending.seat), seat={provider:'qwen',model:'qwen3.8-flash'};
  const options={env:{QWEN_API_KEY:'fixture',QWEN_BASE_URL:'https://example.invalid/v1'}};
  for (const [oldPrefix,prefix,v] of [['expert-read','expert-audit',23],['expert-read-search','expert-audit-search',24]]) {
    const old=buildRequest(view,seat,{...options,contextProfile:oldPrefix+'-zh',endgameAnalysis:{value:null}});
    const zh=buildRequest(view,seat,{...options,contextProfile:prefix+'-zh',endgameAnalysis:{value:null}});
    const en=buildRequest(view,seat,{...options,contextProfile:prefix+'-en',endgameAnalysis:{value:null}});
    const info=JSON.parse(zh.body.messages[1].content), oldInfo=JSON.parse(old.body.messages[1].content);
    assert.equal(info.v,v);assert.equal(info.history.length%4,0);assert.ok(info.trick.length);
    assert.equal(info.history.length+info.trick.length,oldInfo.history.length);
    const ids=[...info.history,...info.trick].flatMap(([,cards])=>cards.map(([id])=>id));
    assert.equal(new Set(ids).size,ids.length);
    assert.equal(zh.body.messages[1].content,en.body.messages[1].content);
    assert.deepEqual(zh.body.tools,en.body.tools);assert.deepEqual(zh.body.tools,old.body.tools);
    assert.deepEqual(zh.legalMoves,old.legalMoves);
    assert.match(zh.body.messages[0].content,/先出黑桃A/);
    assert.match(en.body.messages[0].content,/second spade ace does not beat the first/);
    assert.equal(oldInfo.trickAudit,undefined);
  }
});

test('public kitty bounds contain the true value throughout complete deals and final accounting matches the engine', () => {
  for(const seed of [91401,91402,91403,91404]) {
    let state=cardPlayFixture(seed), finals=0;
    while(state.pending) {
      const d=state.pending,view=observation(state,d.seat),bounds=kittyPointBounds(view),actual=points(state.kitty);
      assert.ok(bounds.range && bounds.range[0]<=actual && bounds.range[1]>=actual,seed+': '+d.id);
      if(view.seat===state.dealer)assert.deepEqual(bounds.range,[actual,actual]);
      const audit=buildTrickAudit(view,followMoves(view));
      const next=applyAction(state,{decisionId:d.id,version:d.version,seat:d.seat,action:choosePeilian(view)});
      if(audit.finalWithKitty?.length) {
        finals++;
        assert.equal(audit.finalWithKitty.length,1);
        const end=audit.finalWithKitty[0];
        assert.deepEqual(end.attackerFinalPointsRange,[next.score.total,next.score.total]);
        assert.equal(end.dealResult, (next.score.attackersWin === (view.seat%2!==state.dealer%2))?'win':'loss');
      }
      state=next;
    }
    assert.equal(finals,1);
  }
});

test('incomplete inventory remains unknown; complete final public information can prove kitty points without revealing faces', () => {
  const view={...base,plays:[{seat:0,cards:[c('S',14)]}],hand:[c('S',14,1)]};
  assert.equal(kittyPointBounds(view).range,null);
  const state=cardPlayFixture(91405), valid=observation(state,state.pending.seat);
  assert.equal(kittyPointBounds({...valid, hand:[...valid.hand,valid.hand[0]]}).range,null);
  const actor=(state.dealer+1)%4, own=observation(state,actor), expected=kittyPointBounds(own);
  assert.deepEqual(kittyPointBounds({...own,hands:state.hands,unknownKitty:state.kitty,seed:123,quiz:{answer:'secret'}}),expected);
  assert.deepEqual(Object.keys(expected).sort(),['basis','range']);
});
