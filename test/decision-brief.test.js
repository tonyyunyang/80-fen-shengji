import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck } from '../src/cards.js';
import { buildRequest, compactObservation, followMoves } from '../src/providers.js';
import { cardPlayFixture } from '../scripts/paired-eval.mjs';
import { observation, applyAction } from '../src/game.js';
import { choosePeilian } from '../src/peilian.js';

const env = { QWEN_API_KEY: 'fixture-only', QWEN_BASE_URL: 'https://example.invalid/v1' };
const seat = { provider: 'qwen', model: 'fixture' };

test('joined action rows preserve the complete menu and expose the exact partnership score threshold', () => {
  const deck = makeDeck(), card = rank => deck.find(c => c.suit === 'H' && c.rank === rank);
  const view = { seat: 3, myTeam: 1, declSeat: 0, dealer: 0, dealerKnown: true,
    trump: { suit: 'D', rank: 2 }, phase: 'follow', hand: [card(5), card(3)],
    handSizes: [1,1,1,2], attackPoints: 65,
    plays: [{seat:0,cards:[card(10)]},{seat:1,cards:[card(14)]},{seat:2,cards:[card(9)]}],
    history: [], rules: {}, buriedKnown: [], declarations: [] };
  const moves = followMoves(view), before = compactObservation(view, moves, 'partnership');
  const after = compactObservation(view, moves, 'decision-first');
  assert.equal(after.v, 11); assert.equal(after.partnership.partner, 1);
  assert.deepEqual(after.legalMoves.map(({id,card_ids}) => ({id,card_ids})), before.legalMoves);
  const five = after.legalMoves.find(move => move.card_ids.includes(card(5).id));
  const three = after.legalMoves.find(move => move.card_ids.includes(card(3).id));
  assert.equal(five.teamOutcome, 'secured'); assert.equal(five.clinchesAttackerTakeover, true);
  assert.equal(three.clinchesAttackerTakeover, false);
  assert.match(five.cards, /5/); assert.equal(five.pointsSpent, 5);
  assert.equal(after.referenceAdvice, undefined);
});

test('brief requests ignore injected hidden hands, unknown kitty, shuffle seed and quiz data', () => {
  let state = cardPlayFixture(903);
  const d = state.pending;
  state = applyAction(state, { decisionId:d.id, version:d.version, seat:d.seat, action:choosePeilian(observation(state,d.seat)) });
  const actor = state.pending.seat;
  const view = observation(state, actor), altered = structuredClone(view);
  Object.assign(altered, { seed: 999, hands: state.hands, unknownKitty: state.kitty, quiz: { answer: 'private' } });
  for (const contextProfile of ['decision-first','decision-first-advised']) {
    const options = { env, contextProfile };
    assert.deepEqual(buildRequest(view, seat, options), buildRequest(altered, seat, options));
    const payload = JSON.parse(buildRequest(view, seat, options).body.messages[1].content);
    assert.equal(payload.partnership.partner, (actor + 2) % 4);
    assert.equal(!!payload.referenceAdvice, contextProfile.endsWith('-advised'));
  }
});

test('brief direct-card actions retain only own card IDs and leave the full lead space available', () => {
  const state = cardPlayFixture(905), view = observation(state, state.pending.seat);
  const request = buildRequest(view, seat, { env, contextProfile: 'decision-first' });
  const payload = JSON.parse(request.body.messages[1].content);
  assert.deepEqual(payload.hand, compactObservation(view).hand);
  assert.deepEqual(payload.history, compactObservation(view).history);
  assert.equal(request.body.tools[0].function.name, 'play_cards');
  assert.deepEqual(request.body.tools[0].function.parameters.properties.card_ids.items.enum, view.hand.map(card => card.id));
  assert.equal(payload.legalMoves, undefined);
  assert.match(payload.actionContext.groupMeaning, /not a complete lead menu/);
});
