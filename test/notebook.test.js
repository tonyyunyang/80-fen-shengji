import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck } from '../src/cards.js';
import { buildNotebook } from '../src/notebook.js';
import { createGame, observation, applyAction } from '../src/game.js';
import { choosePeilian } from '../src/peilian.js';
import { compactObservation } from '../src/providers.js';
const deck = makeDeck();
const c = (suit, rank, copy = 0) => deck.find(card => card.suit === suit && card.rank === rank && Math.floor(card.id / 54) === copy);
const base = { seat: 0, declSeat: 0, trump: { suit: 'H', rank: 7 }, hand: [], buriedKnown: [], history: [], plays: [], attackPoints: 20 };

test('counts both jokers, deduplicates the current trick, and includes unknown kitty possibilities', () => {
  const plays = [{ seat: 1, cards: [c('X', 16)] }, { seat: 2, cards: [c('X', 15)] }];
  const n = buildNotebook({ ...base, hand: [c('X', 16, 1)], history: plays, plays });
  assert.deepEqual(n.jokers[0], { rank: 16, played: 1, held: 1, buried: 0, unlocated: 0 });
  assert.equal(n.jokers[1].unlocated, 1);
  assert.equal(n.suits.reduce((sum, suit) => sum + suit.unlocated, 0), 105);
  assert.deepEqual(n.suits[0].topUnplayed, [['X', 16, 1]]);
  assert.deepEqual(n.currentTrick, { winningSeat: 1, points: 0, seatsStillToPlay: [3, 0] });
});
test('only failure to follow proves a void, and effective trumps include level cards', () => {
  const history = [{ seat: 0, cards: [c('S', 14), c('S', 14, 1)] },
    { seat: 1, cards: [c('S', 3), c('D', 3)] },
    { seat: 2, cards: [c('S', 4), c('S', 5)] },
    { seat: 3, cards: [c('S', 7), c('C', 7)] }];
  const n = buildNotebook({ ...base, history });
  assert.deepEqual(n.provenVoids, [{ seat: 1, suit: 'S', afterTrick: 1 }, { seat: 3, suit: 'S', afterTrick: 1 }]);
  assert.deepEqual(n.suits.find(suit => suit.suit === 'S').topUnplayed, [['S', 13, 2]]);
  assert.equal(n.suits.find(suit => suit.suit === 'S').unlocatedFaces.some(face => face[1] === 7), false);
  assert.equal(n.publicPlayerHistory[0].tricksWon, 1);
  assert.equal(n.publicPlayerHistory[0].pointsWon, 5);
  assert.deepEqual(n.publicPlayerHistory[0].leads, { S: 1 });
});
test('top no-trump level faces retain equal order and own burial is excluded', () => {
  const n = buildNotebook({ ...base, trump: { suit: null, rank: 7 }, buriedKnown: deck.filter(card => card.suit === 'X') });
  assert.equal(n.suits[0].topUnplayed.length, 4);
  assert.equal(n.jokers[0].unlocated, 0);
  assert.equal(buildNotebook({ ...base, trump: null }), null);
});
test('provider context is unchanged when hidden hands, seed and unknown kitty change', () => {
  let state = createGame({ seed: 144, seats: Array.from({ length: 4 }, () => ({ kind: 'peilian' })) });
  while (!state.trump || state.phase === 'bury') {
    const d = state.pending;
    state = applyAction(state, { decisionId: d.id, version: d.version, seat: d.seat, action: choosePeilian(observation(state, d.seat), d.id) });
  }
  const seat = (state.dealer + 1) % 4;
  const a = compactObservation(observation(state, seat));
  const other = (seat + 1) % 4;
  [state.hands[other][0], state.kitty[0]] = [state.kitty[0], state.hands[other][0]];
  state.seed = 999;
  const b = compactObservation(observation(state, seat));
  assert.deepEqual(a, b);
  assert.ok(a.notebook);
});
