import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeDeck, points, shuffle, randomSource, effectiveSuit, order } from '../src/cards.js';
import * as R from '../src/rules.js';
import { createGame, applyAction, observation, publicView, safeAction, nextDeal, assertConservation } from '../src/game.js';
import { choosePeilian } from '../src/peilian.js';
import { trainingQuestion } from '../src/training.js';
const reference = createRequire(import.meta.url)('../vendor/peilian/reference-core.cjs');
const deck = makeDeck();
const c = (suit, rank, copy = 0) => deck.find((card) => card.suit === suit && card.rank === rank && Number(card.id >= 54) === copy);
const pair = (suit, rank) => [c(suit, rank), c(suit, rank, 1)];
const seats = Array.from({ length: 4 }, (_, seat) => ({ kind: 'peilian', name: '玩家' + seat }));
const envelope = (s, action) => ({ decisionId: s.pending.id, seat: s.pending.seat, version: s.version, action });
function untilPlay(s) {
  while (s.pending && !['lead', 'follow'].includes(s.pending.phase)) s = applyAction(s, envelope(s, safeAction(observation(s, s.pending.seat))));
  return s;
}

test('108 unique physical cards, two copies per face, 200 points', () => {
  assert.equal(deck.length, 108); assert.equal(new Set(deck.map((card) => card.id)).size, 108);
  assert.equal(R.groups(deck).length, 54); assert.equal(points(deck), 200);
});
test('card order and effective suits match the pinned rules for every trump/level', () => {
  for (const suit of [null, 'S', 'H', 'D', 'C']) for (let rank = 2; rank <= 14; rank++) for (const card of deck) {
    const trump = { suit, rank };
    assert.equal(effectiveSuit(card, trump), reference.effSuit(card, trump));
    assert.equal(order(card, trump), reference.ordIdx(card, trump));
  }
});
test('level gaps create tractors; equal-order level pairs do not break a chain', () => {
  assert.equal(R.classify([...pair('H', 6), ...pair('H', 8)], { suit: 'S', rank: 7 }).type, 'tractor');
  assert.equal(R.classify([...pair('H', 6), ...pair('H', 8)], { suit: 'S', rank: 2 }).type, 'throw');
  const layered = [...pair('S', 14), ...pair('H', 2), ...pair('D', 2), ...pair('S', 2)];
  assert.equal(R.longestTractor(layered, { suit: 'S', rank: 2 }), 3);
  assert.equal(R.classify([c('H', 3), c('D', 4)], { suit: 'S', rank: 2 }), null);
});
test('following enforces suit, pairs and shorter available tractors together', () => {
  const trump = { suit: 'S', rank: 2 };
  const lead = R.classify([...pair('H', 10), ...pair('H', 11)], trump);
  const hand = [...pair('H', 5), ...pair('H', 6), ...pair('H', 13), c('H', 3), c('D', 2)];
  assert.ok(R.followError(hand, [...pair('H', 5), ...pair('H', 13)], lead, trump));
  assert.equal(R.followError(hand, [...pair('H', 5), ...pair('H', 6)], lead, trump), null);
  const longLead = R.classify([...pair('H', 10), ...pair('H', 11), ...pair('H', 12)], trump);
  assert.ok(R.legalFollow(hand, R.safeFollow(hand, longLead, trump), longLead, trump));
});
test('generated follows and random candidates agree with reference across 500 deals', () => {
  const rand = randomSource(91);
  for (let i = 0; i < 500; i++) {
    const dealt = shuffle(deck, rand), trump = { suit: [null, 'S', 'H', 'D', 'C'][i % 5], rank: i % 13 + 2 };
    const hand = dealt.slice(0, 25), leader = dealt.slice(25, 50);
    const ledSuit = effectiveSuit(leader[0], trump);
    const cards = leader.filter((card) => effectiveSuit(card, trump) === ledSuit).slice(0, i % 6 + 1);
    const lead = R.classify(cards, trump), oldLead = reference.classify(cards, trump);
    assert.equal(lead.type, oldLead.type);
    const generated = R.safeFollow(hand, lead, trump);
    assert.equal(R.legalFollow(hand, generated, lead, trump), true);
    assert.equal(reference.isLegalFollow(hand, oldLead, generated, trump), true);
    const chosen = shuffle(hand, rand).slice(0, cards.length);
    assert.equal(R.legalFollow(hand, chosen, lead, trump), reference.isLegalFollow(hand, oldLead, chosen, trump));
  }
});
test('a failed throw forces the lowest-top component, without modifying unrelated cards', () => {
  const trump = { suit: 'S', rank: 2 };
  const throwCards = [c('H', 5), c('H', 14)];
  const hands = [throwCards, [c('H', 13)], [c('D', 5)], [c('C', 5)]];
  assert.deepEqual(R.adjudicateThrow(hands, 0, throwCards, trump), { failed: true, cards: [c('H', 5)] });
});
test('trick ties belong to earlier play; only a matching trump structure can win', () => {
  const trump = { suit: 'S', rank: 2 };
  const plays = [{ seat: 0, cards: pair('H', 5) }, { seat: 1, cards: [c('S', 10), c('S', 11)] }, { seat: 2, cards: pair('H', 6) }, { seat: 3, cards: pair('D', 7) }];
  assert.equal(R.resolveTrick(plays, trump).winner, 2);
  assert.equal(R.resolveTrick([{ seat: 2, cards: [c('H', 14)] }, { seat: 3, cards: [c('H', 14, 1)] }], trump).winner, 2);
});
test('score boundaries, kitty multiplier, dealer rotation and mandatory levels', () => {
  for (const total of [0, 35, 40, 75, 80, 115, 120, 195, 200]) {
    const actual = R.scoreDeal(total, [], false, 1);
    const old = reference.scoreRound({ defPoints: total, kitty: [], defWonLastTrick: false, lastLeadSize: 1 });
    assert.equal(actual.attackersWin, old.defendersWin);
    assert.equal(actual.levelsUp, old.defendersWin ? old.defenderLevelsUp : old.declarerLevelsUp);
  }
  assert.equal(R.scoreDeal(60, [c('H', 5)], true, 2).total, 80);
  const match = { levels: [2, 2], played: [-1, -1], dealer: 0, round: 0, winner: -1 };
  const attackers = R.advanceMatch(match, 0, R.scoreDeal(160, [], false, 1), R.DEFAULT_RULES);
  assert.equal(attackers.levels[1], 2); assert.equal(attackers.dealer, 1);
  const defenders = R.advanceMatch(match, 0, R.scoreDeal(0, [], false, 1), R.DEFAULT_RULES);
  assert.equal(defenders.levels[0], 5); assert.equal(defenders.dealer, 2);
});
test('declaration rules prevent self-countering and allow eligible reinforcement', () => {
  const hand = [...pair('H', 2), ...pair('D', 2), ...pair('X', 16)];
  const current = { seat: 0, suit: 'H', strength: 1 };
  assert.deepEqual(R.declarationOptions(hand, 2, current, 0).map((option) => option.id), ['H2']);
  assert.equal(R.declarationOptions(hand, 2, current, 0, true).length, 0);
  assert.ok(R.declarationOptions(hand, 2, current, 1).some((option) => option.id === 'X4'));
});
test('closing declaration opportunities do not draw another card', () => {
  let s = createGame({ seed: 12, seats });
  let closed = 0;
  while (s.pending && s.pending.phase === 'declare') {
    if (s.phase === 'closing') {
      closed++; assert.equal(s.dealt, 100); assert.equal(s.deck.length, 8);
      assert.deepEqual(s.hands.map((hand) => hand.length), [25, 25, 25, 25]);
    }
    s = applyAction(s, envelope(s, { type: 'declare', choice: 'pass' }));
  }
  assert.ok(closed > 0);
});
test('invalid, duplicate and stale actions do not mutate the game', () => {
  const s = untilPlay(createGame({ seed: 1, seats }));
  const before = structuredClone(s), id = s.hands[s.pending.seat][0].id;
  assert.throws(() => applyAction(s, envelope(s, { type: 'play', cardIds: [id, id] })));
  assert.deepEqual(s, before);
  const request = envelope(s, { type: 'play', cardIds: [id] });
  const next = applyAction(s, request);
  assert.throws(() => applyAction(next, request), /STALE/);
  assert.deepEqual(s, before);
});
test('player views, API inputs and training do not depend on hidden opponent cards', () => {
  let s = untilPlay(createGame({ seed: 2, seats: seats.map((seat, i) => ({ ...seat, kind: i ? 'peilian' : 'human' })) }));
  for (let i = 0; i < 8; i++) s = applyAction(s, envelope(s, safeAction(observation(s, s.pending.seat))));
  const other = structuredClone(s);
  [other.hands[1][0], other.hands[3][0]] = [other.hands[3][0], other.hands[1][0]];
  other.seed += 123;
  assert.deepEqual(observation(s, 0), observation(other, 0));
  assert.deepEqual(trainingQuestion(publicView(s, 0)), trainingQuestion(publicView(other, 0)));
  assert.equal(publicView(s, 1).hand.length, 0);
  assert.equal('deck' in publicView(s, 0), false);
  assert.equal('seed' in observation(s, 0), false);
});
test('preserved strategy produces identical lead/follow/discard decisions on fixed observations', () => {
  let s = createGame({ seed: 4, seats });
  let checked = 0;
  while (s.pending) {
    const view = observation(s, s.pending.seat);
    const action = choosePeilian(view, s.pending.id);
    if (['lead', 'follow', 'bury'].includes(view.phase)) {
      const input = structuredClone(view);
      const expected = view.phase === 'bury' ? reference.aiDiscard(input.hand, input.trump) : (view.phase === 'lead' ? reference.aiChooseLead(input) : reference.aiChooseFollow(input, input.plays)).cards;
      assert.deepEqual(action.cardIds, expected.map((card) => card.id)); checked++;
    }
    s = applyAction(s, envelope(s, action)); assertConservation(s);
  }
  assert.ok(checked > 20);
});
test('twenty complete practice deals conserve all cards after every action', () => {
  for (let seed = 1; seed <= 20; seed++) {
    let s = createGame({ seed, seats }); let count = 0;
    while (s.pending && count++ < 250) {
      s = applyAction(s, envelope(s, choosePeilian(observation(s, s.pending.seat), s.pending.id)));
      assertConservation(s);
    }
    assert.equal(s.phase, 'round_over'); assert.ok(s.tricks.length <= 25);
  }
});
test('offline players can complete a multi-deal leveling match', () => {
  let s = createGame({ seed: 7, seats, rules: { speedRun: true } });
  while (s.match.winner < 0 && s.match.round < 60) {
    while (s.pending) s = applyAction(s, envelope(s, safeAction(observation(s, s.pending.seat))));
    assertConservation(s);
    if (s.phase === 'round_over') s = nextDeal(s);
  }
  assert.ok(s.match.winner >= 0);
});


test('redeals reset hand knowledge, respect the cap and preserve all cards', () => {
  let s = createGame({ seed: 4, seats, rules: { fullRebel: 'scramble', pointRebelThreshold: 1000 } });
  while (s.pending && !['lead', 'follow'].includes(s.pending.phase)) {
    const action = s.pending.phase === 'rebel' ? { type: 'rebel', accept: true } : safeAction(observation(s, s.pending.seat));
    s = applyAction(s, envelope(s, action)); assertConservation(s);
  }
  assert.equal(s.redeals, 3); assert.equal(s.attempts, 4);
  assert.equal(s.phase, 'play'); assert.deepEqual(s.hands.map((hand) => hand.length), [25, 25, 25, 25]);
});

test('training distinguishes proven voids and counts both copies of a high card', () => {
  const base = { viewer: 0, seats, trump: { suit: 'S', rank: 2 }, buriedKnown: [] };
  const trick = { index: 0, plays: [{ seat: 0, cards: [c('H', 5)] }, { seat: 1, cards: [c('H', 7)] }, { seat: 2, cards: [c('D', 5)] }, { seat: 3, cards: [c('H', 3)] }] };
  const voidQuestion = trainingQuestion({ ...base, tricks: [trick] });
  assert.deepEqual(voidQuestion.correct, ['玩家2']);
  const second = { index: 1, plays: [{ seat: 0, cards: [c('D', 14)] }, { seat: 1, cards: [c('D', 3)] }, { seat: 2, cards: [c('D', 7)] }, { seat: 3, cards: [c('D', 8)] }] };
  assert.deepEqual(trainingQuestion({ ...base, tricks: [trick, second] }).correct, ['♦A']);
  assert.deepEqual(trainingQuestion({ ...base, buriedKnown: [c('D', 14, 1)], tricks: [trick, second] }).correct, ['♦K']);
});

test('decision provenance is retained while burying details remain private', () => {
  let s = createGame({ seed: 13, seats: seats.map((seat) => ({ ...seat, kind: 'human' })) });
  while (s.pending.phase !== 'bury') s = applyAction(s, envelope(s, safeAction(observation(s, s.pending.seat))));
  const dealer = s.pending.seat;
  s = applyAction(s, { ...envelope(s, safeAction(observation(s, dealer))), source: 'human' });
  const audit = s.events.findLast((event) => event.type === 'decision_applied');
  assert.equal(audit.phase, 'bury'); assert.equal(audit.source, 'human');
  assert.equal(audit.audience, dealer); assert.equal(audit.requested.cardIds.length, 8);
  assert.equal(publicView(s, (dealer + 1) % 4).events.some((event) => event.decisionId === audit.decisionId), false);
  assert.equal(publicView(s, dealer).events.some((event) => event.decisionId === audit.decisionId), true);
});

test('random initial dealer is reproducible, covers both teams, and declarations cannot change it', () => {
  const counts=[0,0,0,0];
  for(let seed=1;seed<=64;seed++){
    const initial=createGame({seed,seats,rules:{firstDealer:'random'}}),dealer=initial.dealer;
    counts[dealer]++;assert.equal(initial.dealerKnown,true);
    assert.equal(createGame({seed,seats,rules:{firstDealer:'random'}}).dealer,dealer);
    let state=initial;
    while(state.pending?.phase==='declare'){
      const choice=state.pending.options[0]?.id||'pass';
      state=applyAction(state,envelope(state,{type:'declare',choice}));
    }
    assert.equal(state.dealer,dealer);assert.equal(state.phase,'bury');assertConservation(state);
  }
  assert.ok(counts.every(count=>count>0));
});
