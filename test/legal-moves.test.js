import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck } from '../src/cards.js';
import { classify, enumerateLegalFollows, DEFAULT_RULES } from '../src/rules.js';
import { toolFor, parseToolCall, requestAction, followMoves } from '../src/providers.js';
import { createGame, applyAction, observation, safeAction } from '../src/game.js';
import { Session, validateConfig } from '../server/session.js';
const deck = makeDeck(), trump = { suit: null, rank: 2 };
const cards = (ids) => ids.map((id) => deck[id]);

test('the observed diamond-pair failure exposes both legal pairs, with no singles', () => {
  const hand = cards([37, 91, 36, 90, 30, 81]);
  const moves = enumerateLegalFollows(hand, classify(cards([32, 86]), trump), trump);
  assert.deepEqual(moves, [[37, 91], [36, 90]]);
  assert.equal(toolFor('follow', moves).name, 'play_move');
  assert.deepEqual(parseToolCall('play_move', { move_id: 1 }, 'follow', moves), { type: 'play', cardIds: [36, 90] });
  assert.throws(() => parseToolCall('play_move', { move_id: 2 }, 'follow', moves));
});
test('large legal sets return null rather than a strategically filtered shortlist', () => {
  const lead = classify(cards([32]), trump);
  assert.equal(enumerateLegalFollows(cards([37, 36, 30, 29, 28]), lead, trump, DEFAULT_RULES, 2), null);
});
test('near-whole-hand follows use the small complementary combination count', () => {
  const hand = cards([26, 27, 28, 29, 30]);
  const lead = classify(cards([82, 83, 84, 85]), trump);
  assert.ok(Array.isArray(enumerateLegalFollows(hand, lead, trump, DEFAULT_RULES, 48, 6)));
});
test('a unique legal pair is played without contacting the API', async () => {
  const seats = Array.from({ length: 4 }, () => ({ kind: 'api', provider: 'mock' }));
  let state = createGame({ seed: 12, seats });
  while (state.pending) {
    const view = observation(state, state.pending.seat);
    const moves = followMoves(view);
    if (moves?.length === 1 && view.hand.length > moves[0].length) break;
    state = applyAction(state, { decisionId: state.pending.id, version: state.version, seat: state.pending.seat, action: safeAction(view) });
  }
  assert.ok(state.pending);
  let calls = 0;
  const session = new Session({ providerCall: () => { calls++; throw new Error('Unexpected paid call'); } });
  session.config = validateConfig({ seats }); session.state = state;
  await session.step(); session.stop();
  assert.equal(calls, 0); assert.equal(session.state.lastAction.source, 'forced');
});
test('native move tool selection maps back to physical cards', async () => {
  const state = createGame({ seed: 3, seats: Array.from({ length: 4 }, () => ({ kind: 'peilian' })) });
  const view = { ...observation(state, state.pending.seat), phase: 'follow', trump,
    hand: cards([37, 91, 36, 90, 30, 81]), plays: [{ seat: 3, cards: cards([32, 86]) }] };
  const result = await requestAction(view, { provider: 'qwen', model: 'qwen3.8-flash' }, {
    env: { QWEN_API_KEY: 'fixture-only', QWEN_BASE_URL: 'https://example.invalid/v1' },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({
      choices: [{ finish_reason: 'stop', message: { tool_calls: [{ function: { name: 'play_move', arguments: '{"move_id":1}' } }] } }],
      usage: { prompt_tokens: 500, completion_tokens: 10 },
    }) }),
  });
  assert.deepEqual(result.action.cardIds, [36, 90]);
  assert.equal(result.metering.legalMoveCount, 2);
});
