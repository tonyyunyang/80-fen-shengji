import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck } from '../src/cards.js';
import { buildNotebook } from '../src/notebook.js';
import { buildDecisionContext } from '../src/decision-context.js';
import { compactObservation, followMoves, requestAction } from '../src/providers.js';
import { createGame, observation, applyAction } from '../src/game.js';
import { choosePeilian } from '../src/peilian.js';

const deck = makeDeck();
const card = (suit, rank, copy = 0) => deck.find(c => c.suit === suit && c.rank === rank && Math.floor(c.id / 54) === copy);
function fixture() {
  return { seat: 0, phase: 'follow', trump: { suit: 'H', rank: 7 }, declSeat: 2, dealer: 2,
    hand: [card('S', 4), card('S', 4, 1), card('S', 5), card('S', 13)],
    plays: [{ seat: 1, cards: [card('S', 9)] }, { seat: 2, cards: [card('S', 10)] }, { seat: 3, cards: [card('S', 8)] }],
    history: [], buriedKnown: [], handSizes: [4, 3, 3, 3], attackPoints: 55, rules: {} };
}
test('candidate facts expose point feeding, overtaking partner and splitting a pair without choosing a move', () => {
  const view = fixture(), moves = view.hand.map(card => [card.id]);
  const before = structuredClone(view);
  const context = buildDecisionContext(view, moves, buildNotebook(view));
  assert.equal(context.moves.length, moves.length);
  assert.deepEqual(context.moves.map(move => move.id), [0, 1, 2, 3]);
  assert.equal(context.moves[0].pairsBroken, 1);
  assert.equal(context.moves[2].pointsSpent, 5);
  assert.equal(context.moves[2].winnerSoFar, 2);
  assert.equal(context.moves[2].teamWinningSoFar, true);
  assert.equal(context.moves[2].overtakesPartner, false);
  assert.equal(context.moves[3].overtakesPartner, true);
  assert.equal(context.moves[3].pairsRemaining, 1);
  assert.equal(context.table.knownKittyPoints, null);
  assert.deepEqual(view, before);
  assert.equal('recommendedMove' in context, false);
});
test('remaining-seat context distinguishes a proven void from owning a trump', () => {
  const view = { ...fixture(), seat: 1, hand: [card('H', 3), card('H', 4)], plays: [{ seat: 0, cards: [card('S', 14)] }] };
  const context = buildDecisionContext(view, [[view.hand[0].id]], { suits: [], provenVoids: [{ seat: 2, suit: 'S' }] });
  assert.deepEqual(context.table.seatsAfterThisPlay, [2, 3]);
  assert.deepEqual(context.table.opponentsAfterThisPlay, [2]);
  assert.deepEqual(context.table.provenVoidOpponentsAfterThisPlay, [2]);
  assert.equal(context.moves[0].winnerSoFar, 1);
  assert.equal(context.moves[0].trumpsSpent, 1);
  assert.equal('opponentsWithTrumps' in context.table, false);
});
test('suit control retains no-trump ties and unknown-kitty uncertainty', () => {
  const view = { ...fixture(), phase: 'lead', trump: { suit: null, rank: 7 }, hand: [card('S', 7)], plays: [], buriedKnown: deck.filter(c => c.suit === 'X') };
  const context = buildDecisionContext(view, null, buildNotebook(view));
  const trumps = context.suitControl.find(suit => suit.suit === 'T');
  assert.equal(trumps.higherUnlocatedCopies, 0);
  assert.equal(trumps.tiedUnlocatedCopies, 7);
  assert.equal(context.suitControl.find(suit => suit.suit === 'S').higherUnlocatedCopies, null);
  assert.match(context.basis, /No ownership or win probabilities/);
});
test('final-trick stakes use known burial only and preserve earlier equal winners', () => {
  const view = { ...fixture(), hand: [card('S', 10, 1)], buriedKnown: [card('D', 5), card('D', 13)] };
  const context = buildDecisionContext(view, [[view.hand[0].id]], buildNotebook(view));
  assert.equal(context.table.finalTrick, true);
  assert.equal(context.table.kittyMultiplierIfFinal, 2);
  assert.equal(context.table.knownKittyPoints, 15);
  assert.equal(context.moves[0].winnerSoFar, 2);
  assert.equal(context.moves[0].overtakesPartner, false);
});
test('all context profiles preserve the complete legal menu and richer facts stay out of dealing', () => {
  const view = fixture(), moves = followMoves(view);
  const old = compactObservation(view, moves, 'notebook');
  const next = compactObservation(view, moves, 'tactical');
  assert.equal(old.v, 3); assert.equal(next.v, 4);
  assert.deepEqual(next.legalMoves, old.legalMoves);
  assert.deepEqual(next.notebook, old.notebook);
  assert.equal(next.decisionContext.moves.length, next.legalMoves.length);
  assert.equal('decisionContext' in old, false);
  assert.equal(buildDecisionContext({ ...view, phase: 'declare' }, null, null), null);
});
test('request audit records the actual context profile, including the new default', async () => {
  const env = { QWEN_API_KEY: 'fixture-only', QWEN_BASE_URL: 'https://example.invalid/v1' };
  for (const [profile, expected] of [[undefined, 8], ['partnership', 8], ['search', 9], ['tactical', 4], ['notebook', 3], ['baseline', 2]]) {
    const response = await requestAction(fixture(), { provider: 'qwen', model: 'qwen3.8-flash' }, {
      env, contextProfile: profile,
      fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: 'play_move', arguments: '{"move_id":0}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 4 } }) }),
    });
    assert.equal(response.metering.contextVersion, expected);
  }
});
test('tactical context is invariant under hidden-hand, unknown-kitty and seed changes across deals', () => {
  for (const seed of [191, 207, 401, 587, 809, 1127]) {
    let state = createGame({ seed, dealing: 'ordered', seats: Array.from({ length: 4 }, () => ({ kind: 'peilian' })) });
    while (state.pending?.phase !== 'follow' || state.pending.seat === state.dealer) {
      const d = state.pending;
      state = applyAction(state, { decisionId: d.id, version: d.version, seat: d.seat,
        action: choosePeilian(observation(state, d.seat), d.id, { deterministic: true }) });
    }
    const actor = state.pending.seat, changed = structuredClone(state), other = (actor + 1) % 4;
    [changed.hands[other][0], changed.kitty[0]] = [changed.kitty[0], changed.hands[other][0]];
    changed.seed = seed + 99;
    changed.quiz = { privateAnswer: 'not provider context' };
    const before = compactObservation(observation(state, actor));
    const after = compactObservation(observation(changed, actor));
    assert.deepEqual(after, before);
    assert.ok(before.decisionContext);
  }
});
