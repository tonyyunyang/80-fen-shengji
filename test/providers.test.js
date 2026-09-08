import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, observation, safeAction } from '../src/game.js';
import { buildRequest, requestAction, parseToolCall, compactObservation } from '../src/providers.js';
import { Session, validateConfig } from '../server/session.js';
const seats = Array.from({ length: 4 }, () => ({ kind: 'api', provider: 'mock', name: 'API' }));
const config = { seats, dealing: 'ordered', limits: { maxRequests: 1 }, speed: 2000 };
const fixture = () => { const s = createGame({ seed: 1, seats }); return observation(s, s.pending.seat); };
const env = { OPENAI_API_KEY: 'fixture-only', ANTHROPIC_API_KEY: 'fixture-only', QWEN_API_KEY: 'fixture-only', QWEN_BASE_URL: 'https://example.invalid/v1' };
test('provider request bodies use the native schemas and contain no hidden state', () => {
  const view = fixture();
  for (const provider of ['openai', 'claude', 'qwen']) {
    const request = buildRequest(view, { provider, model: 'fixture-model' }, { env });
    assert.equal(request.body.model, 'fixture-model');
    assert.equal(JSON.stringify(request.body).includes('fixture-only'), false);
    assert.equal(JSON.stringify(request.body).includes('"seed"'), false);
  }
  assert.equal(buildRequest(view, { provider: 'openai', model: 'fixture' }, { env }).body.parallel_tool_calls, false);
  assert.equal(buildRequest(view, { provider: 'claude', model: 'fixture' }, { env }).body.tool_choice.disable_parallel_tool_use, true);
});
test('OpenAI, Claude and Qwen response fixtures normalize to the same action', async () => {
  const view = fixture();
  const samples = {
    openai: { output: [{ type: 'function_call', name: 'declare_trump', arguments: '{"choice":"pass"}' }], usage: { input_tokens: 12, output_tokens: 3 } },
    claude: { content: [{ type: 'tool_use', name: 'declare_trump', input: { choice: 'pass' } }], usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 5 } },
    qwen: { choices: [{ message: { tool_calls: [{ function: { name: 'declare_trump', arguments: '{"choice":"pass"}' } }] } }], usage: { prompt_tokens: 12, completion_tokens: 3 } },
  };
  for (const provider of Object.keys(samples)) {
    const result = await requestAction(view, { provider, model: 'fixture' }, { env, fetchImpl: async () => ({ ok: true, json: async () => samples[provider] }) });
    assert.deepEqual(result.action, { type: 'declare', choice: 'pass' });
    assert.equal(result.usage.output, 3);
    if (provider === 'claude') assert.equal(result.usage.input, 17);
  }
});
test('extra tools, malformed args, missing tools and truncation are rejected', async () => {
  assert.throws(() => parseToolCall('play_cards', { card_ids: [1] }, 'declare'));
  assert.throws(() => parseToolCall('declare_trump', { choice: 'pass', debug: true }, 'declare'));
  const call = { type: 'function_call', name: 'declare_trump', arguments: '{"choice":"pass"}' };
  for (const data of [{ output: [] }, { output: [call, call] }, { status: 'incomplete', output: [call] }]) {
    await assert.rejects(requestAction(fixture(), { provider: 'openai', model: 'fixture' }, { env, fetchImpl: async () => ({ ok: true, json: async () => data }) }));
  }
});
test('mock mode traverses the tool parser and never calls the network', async () => {
  const result = await requestAction(fixture(), { provider: 'mock' }, { fetchImpl: () => { throw Error('Unexpected network'); } });
  assert.equal(result.simulated, true); assert.equal(result.usage.input, 0);
  assert.deepEqual(result.action, { type: 'declare', choice: 'pass' });
});
test('a changed partial hand remains present even if declaration options are unchanged', () => {
  const a = fixture(), b = structuredClone(a);
  b.hand.push({ id: 35, suit: 'D', rank: 11 });
  assert.notDeepEqual(compactObservation(a).hand, compactObservation(b).hand);
});
test('four seat validation rejects invalid counts and unavailable live providers', () => {
  assert.throws(() => validateConfig({ seats: seats.slice(0, 3) }));
  assert.throws(() => validateConfig({ seats: seats.map((s) => ({ ...s, provider: 'openai', model: 'x' })) }, { mock: true }));
  assert.equal(validateConfig(config).seats.length, 4);
});
test('late model reply cannot act on a newly started game or charge its token stats', async () => {
  let resolve;
  const session = new Session({ providerCall: (view) => new Promise((r) => { resolve = () => r({ action: safeAction(view), usage: { input: 10, output: 2, cached: 0, cacheWrite: 0 }, ms: 1, simulated: true }); }) });
  session.start(config); clearTimeout(session.timer);
  const running = session.step();
  const previousId = session.state.id;
  session.start(config); clearTimeout(session.timer);
  const snapshot = structuredClone(session.state);
  resolve(); await running;
  assert.notEqual(session.state.id, previousId);
  assert.deepEqual(session.state, snapshot);
  assert.equal(session.stats.input, 0);
  session.stop();
});
test('bad API actions get one retry and a visible fallback', async () => {
  let calls = 0;
  const session = new Session({ providerCall: async () => { calls++; throw new Error('fixture failure'); } });
  session.start(config); clearTimeout(session.timer);
  await session.step(); session.stop();
  assert.equal(calls, 2); assert.equal(session.stats.fallbacks, 1);
  assert.equal(session.state.lastAction.source, 'fallback');
});
test('real request count limit uses peilian without another request', async () => {
  let calls = 0;
  const session = new Session({ env, providerCall: async (view) => { calls++; return { action: safeAction(view), usage: { input: 1, output: 1, cached: 0, cacheWrite: 0 }, ms: 1, simulated: false }; } });
  session.start({ ...config, seats: seats.map((s) => ({ ...s, provider: 'openai', model: 'fixture' })) }); clearTimeout(session.timer);
  await session.step(); clearTimeout(session.timer);
  await session.step(); session.stop();
  assert.equal(calls, 1); assert.equal(session.paused, false);
  assert.equal(session.state.lastAction.source, 'fallback');
  assert.equal(session.logs.findLast((entry) => entry.fallback).policy, 'peilian');
  assert.equal(session.stats.realRequests, 1);
});


test('one human, one 陪练 and two simulated API seats complete a deal together', async () => {
  const session = new Session();
  session.start({ dealing: 'ordered', seats: [
    { kind: 'human', name: '你' }, { kind: 'api', provider: 'mock', name: '东' },
    { kind: 'peilian', name: '北' }, { kind: 'api', provider: 'mock', name: '西' },
  ] });
  clearTimeout(session.timer);
  let decisions = 0;
  while (session.state.pending && decisions++ < 250) {
    if (session.state.seats[session.state.pending.seat].kind === 'human') {
      const d = session.state.pending;
      session.human({ decisionId: d.id, seat: d.seat, version: d.version, action: safeAction(observation(session.state, d.seat)) });
    } else await session.step();
    clearTimeout(session.timer);
  }
  session.stop();
  assert.equal(session.state.phase, 'round_over');
  assert.ok(session.stats.simulated > 0); assert.ok(session.stats.peilian > 0);
  assert.equal(session.stats.realRequests, 0); assert.equal(session.stats.fallbacks, 0);
});

test('resuming a table without credentials uses peilian without a network attempt', async () => {
  let checkpoint;
  const old = new Session({ env, persist: (data) => { checkpoint = structuredClone(data); } });
  old.start({ ...config, seats: seats.map((seat) => ({ ...seat, provider: 'openai', model: 'fixture' })) }); old.stop();
  let calls = 0;
  const restored = new Session({ env: {}, providerCall: async () => { calls++; throw new Error('Unexpected request'); } });
  restored.restore(checkpoint); restored.pause(false); clearTimeout(restored.timer);
  await restored.step(); restored.stop();
  assert.equal(calls, 0); assert.equal(restored.stats.realRequests, 0); assert.equal(restored.paused, false);
  assert.equal(restored.state.lastAction.source, 'fallback');
});
