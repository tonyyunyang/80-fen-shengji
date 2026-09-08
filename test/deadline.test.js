import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, validateConfig } from '../server/session.js';
import { createGame, observation, applyAction, safeAction } from '../src/game.js';
import { choosePeilian } from '../src/peilian.js';
import { MAX_DECISION_MS } from '../src/player-settings.js';

const env = { QWEN_API_KEY: 'fixture-only', QWEN_BASE_URL: 'https://example.invalid/v1' };
const seats = Array.from({ length: 4 }, () => ({ kind: 'api', provider: 'qwen', model: 'qwen3.8-flash' }));
const config = { seats, speed: 2000, limits: { timeoutMs: 12000 } };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup(providerCall) {
  const session = new Session({ env, providerCall });
  session.config = validateConfig(config, { qwen: true });
  session.state = createGame({ id: 'deadline-fixture', seed: 21, seats });
  return session;
}

test('deadline defaults and restored legacy limits never exceed twelve seconds', () => {
  assert.equal(validateConfig({ seats }, { qwen: true }).limits.timeoutMs, MAX_DECISION_MS);
  assert.equal(validateConfig({ seats, limits: { timeoutMs: 30000 } }, { qwen: true }).limits.timeoutMs, 12000);
  const session = setup(() => {});
  session.restore({ schemaVersion: 1, state: session.state, config: { ...session.config, limits: { timeoutMs: 20000 } }, stats: { latency: [5] } });
  assert.equal(session.config.limits.timeoutMs, 12000); assert.equal(session.paused, true);
  assert.deepEqual(session.stats.latency, []); session.stop();
});
test('a hanging provider falls back at the deadline without waiting for abort cooperation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let calls = 0, signal;
  const session = setup((view, seat, options) => { calls++; signal = options.signal; return new Promise(() => {}); });
  t.after(() => session.stop());
  const decision = session.state.pending;
  const expected = choosePeilian(observation(session.state, decision.seat), decision.id);
  const running = session.step();
  assert.equal(session.busy.api, true);
  assert.equal(session.busy.deadlineAt - session.busy.startedAt, 12000);
  t.mock.timers.tick(11999); await flush();
  assert.equal(session.state.version, 0); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); await running;
  assert.equal(calls, 1); assert.equal(signal.aborted, true); assert.equal(session.busy, null);
  const applied = session.state.events.findLast((event) => event.type === 'decision_applied');
  assert.deepEqual(applied.requested, expected); assert.equal(applied.source, 'fallback');
  assert.equal(session.logs.findLast((entry) => entry.fallback).policy, 'peilian');
  assert.equal(session.stats.usageUnknown, 1);
});
test('a repair request shares the original deadline instead of receiving another twelve seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let calls = 0;
  const session = setup(() => { calls++; return calls === 1 ? new Promise((_, reject) => setTimeout(() => reject(new Error('Malformed fixture')), 8000)) : new Promise(() => {}); });
  t.after(() => session.stop());
  const running = session.step(), deadline = session.busy.deadlineAt;
  t.mock.timers.tick(8000); await flush();
  assert.equal(calls, 2); assert.equal(session.busy.attempt, 2); assert.equal(session.busy.deadlineAt, deadline);
  t.mock.timers.tick(3999); await flush(); assert.equal(session.state.version, 0);
  t.mock.timers.tick(1); await running;
  assert.equal(session.state.version, 1); assert.equal(session.stats.fallbacks, 1);
  assert.equal(session.stats.realRequests, 2); assert.equal(session.stats.usageUnknown, 2);
});
test('late usage reconciles once but a late action cannot replace the peilian move', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let resolve, proposed;
  const session = setup((view) => { proposed = safeAction(view); return new Promise((r) => { resolve = r; }); });
  t.after(() => session.stop());
  const running = session.step(); t.mock.timers.tick(12000); await running;
  const afterFallback = structuredClone(session.state);
  assert.equal(session.stats.usageUnknown, 1);
  resolve({ action: proposed, usage: { input: 25, output: 5, cached: 0, cacheWrite: 0 }, usageKnown: true, simulated: false, ms: 15000 });
  await flush();
  assert.deepEqual(session.state, afterFallback);
  assert.equal(session.stats.input, 25); assert.equal(session.stats.output, 5);
  assert.equal(session.stats.usageUnknown, 0); assert.equal(session.stats.realRequests, 1);
  assert.equal(session.stats.cacheUnknown, 0);
  assert.equal(session.stats.latency.length, 1);
  assert.equal(session.logs.filter((entry) => entry.type === 'late_response').length, 1);
});
test('API failure uses the preserved strategy in declaration, burying, lead, and follow phases', async () => {
  let state = createGame({ id: 'fallback-phases', seed: 21, seats });
  const snapshots = new Map();
  while (state.pending && snapshots.size < 4) {
    const decision = state.pending;
    if (['declare', 'bury', 'lead', 'follow'].includes(decision.phase) && !snapshots.has(decision.phase)) snapshots.set(decision.phase, structuredClone(state));
    state = applyAction(state, { decisionId: decision.id, version: state.version, seat: decision.seat, action: safeAction(observation(state, decision.seat)) });
  }
  assert.equal(snapshots.size, 4);
  for (const state of snapshots.values()) {
    const session = setup(async () => { throw new Error('Provider unavailable'); });
    session.state = state;
    const decision = state.pending, expected = choosePeilian(observation(state, decision.seat), decision.id);
    try {
      await session.step();
      assert.equal(session.state.lastAction.source, 'fallback');
      assert.deepEqual(session.state.events.findLast((e) => e.type === 'decision_applied').requested, expected);
    } finally { session.stop(); }
  }
});
test('a declaration waits on the current partial hand and later draws can ask again', async () => {
  let release, calls = 0;
  const views = [];
  const session = setup((view) => { calls++; views.push(structuredClone(view)); return new Promise((r) => { release = () => r({ action: { type: 'declare', choice: 'pass' }, usage: { input: 10, output: 2 }, simulated: false, ms: 1 }); }); });
  try {
    const dealt = session.state.dealt;
    const first = session.step();
    assert.equal(views[0].phase, 'declare'); assert.ok(views[0].options.length);
    assert.ok(views[0].hand.length < 25); assert.equal(session.state.dealt, dealt);
    assert.equal('deck' in views[0], false); assert.equal('seed' in views[0], false);
    release(); await first; clearTimeout(session.timer);
    assert.ok(session.state.dealt > dealt);
    const second = session.step(); assert.equal(calls, 2);
    assert.ok(views[1].dealt > views[0].dealt);
    release(); await second;
  } finally { session.stop(); }
});
test('API latency exposes mean separately from nearest-rank median', () => {
  const session = setup(() => {});
  session.stats.latency = [1000, 1000, 1000, 1000, 12000];
  const stats = session.view(-1).stats;
  assert.equal(stats.mean, 3200); assert.equal(stats.p50, 1000); assert.equal(stats.p95, 12000);
  session.stop();
});
