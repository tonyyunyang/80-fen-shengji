import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck } from '../src/cards.js';
import { createGame, drawCard, applyBid, closeBidding, observation, publicView, isBidding, safeAction, assertConservation } from '../src/game.js';
import { Session, validateConfig } from '../server/session.js';
import { bidKey } from '../server/bidding.js';
import { TOKEN_PLAN_MODELS, DEFAULT_TOKEN_PLAN_MODEL } from '../src/model-catalog.js';
const env = { QWEN_API_KEY: 'fixture-only', QWEN_BASE_URL: 'https://example.invalid/v1' };
const seats = [{ kind: 'human', name: '你' }, ...[1, 2, 3].map(i => ({ kind: 'api', provider: 'qwen', model: 'qwen3.8-flash', name: 'API' + i }))];
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const card = (suit, rank, copy = 0) => makeDeck().filter(c => c.suit === suit && c.rank === rank)[copy];
function game(players = seats, prefix = []) {
  const s = createGame({ id: 'continuous-fixture', seed: 21, seats: players, dealing: 'continuous' });
  s.first = 0;
  if (!prefix.length) prefix = [0, 1].flatMap(copy => ['S', 'H', 'D', 'C'].map(suit => card(suit, 2, copy)));
  s.deck = [...prefix, ...makeDeck().filter(c => !prefix.some(p => p.id === c.id))];
  return s;
}
const draw = (s, n) => { for (let i = 0; i < n; i++) { s = drawCard(s); assertConservation(s); } return s; };
const bid = (s, view, choice, source = 'api') => applyBid(s, { ...view.bidContext, seat: view.seat, choice, source }, view.options.map(o => o.id));
function runner(providerCall, state = game()) {
  const s = new Session({ env, providerCall });
  s.config = validateConfig({ seats: state.seats, speed: 50 }, { qwen: true, mock: true }); s.state = state;
  return s;
}

test('Qwen 3.8 Flash remains the cheapest default on both published token rates, including idle rates', () => {
  const chosen = TOKEN_PLAN_MODELS.find(model => model.id === DEFAULT_TOKEN_PLAN_MODEL);
  assert.equal(chosen.id, 'qwen3.8-flash');
  for (const model of TOKEN_PLAN_MODELS) {
    assert.ok(chosen.input <= (model.offPeak?.input ?? model.input));
    assert.ok(chosen.output <= (model.offPeak?.output ?? model.output));
  }
});
test('an API seat without an explicit provider/model defaults to Qwen 3.8 Flash', () => {
  const config = validateConfig({ seats: [{ kind: 'human' }, { kind: 'api' }, { kind: 'api' }, { kind: 'api' }] }, { qwen: true });
  assert.equal(config.dealing, 'continuous'); assert.equal(config.dealIntervalMs, 500);
  assert.ok(config.seats.slice(1).every(seat => seat.provider === 'qwen' && seat.model === 'qwen3.8-flash'));
});
test('draws never create a blocking declaration turn, and closure preserves all 108 cards', () => {
  let s = game(); assert.equal(s.pending, null); assert.equal(s.dealt, 0);
  s = draw(s, 100);
  assert.equal(s.phase, 'closing'); assert.equal(s.pending, null);
  assert.deepEqual(s.hands.map(h => h.length), [25, 25, 25, 25]);
  s = closeBidding(s); assert.equal(s.pending.phase, 'bury'); assertConservation(s);
});
test('first single wins; late single is silent, cannot be auto-upgraded, and a new pair can counter', () => {
  let s = draw(game(), 4);
  const human = observation(s, 0), api = observation(s, 1);
  s = bid(s, human, 'S1', 'human');
  const accepted = structuredClone(s);
  assert.throws(() => bid(s, api, 'H1'), { code: 'SUPERSEDED_BID' });
  assert.deepEqual(s, accepted);
  s = draw(s, 4);
  assert.throws(() => bid(s, api, 'H2')); // Pair was absent from the original observation.
  assert.equal(s.declaration.strength, 1);
  s = bid(s, observation(s, 1), 'H2'); assert.equal(s.declaration.strength, 2);
  assert.equal(publicView(s, 0).events.filter(e => e.type === 'declaration').length, 2);
  assert.equal(publicView(s, 0).events.some(e => e.type === 'decision_applied'), false);
});
test('a still-legal older hand works, but old games, redeals and future cards cannot bid', () => {
  let s = draw(game(), 4), old = observation(s, 1);
  s = draw(s, 8); s = bid(s, old, 'H1');
  assert.equal(s.declaration.seat, 1);
  assert.throws(() => applyBid(s, { ...old.bidContext, gameId: 'other', seat: 1, choice: 'H1' }), { code: 'SUPERSEDED_BID' });
  assert.throws(() => applyBid(s, { ...old.bidContext, epoch: 999, seat: 1, choice: 'H1' }), { code: 'SUPERSEDED_BID' });
  assert.throws(() => applyBid(s, { ...old.bidContext, handCount: 25, seat: 1, choice: 'H2' }), { code: 'SUPERSEDED_BID' });
});
test('three hung API seats do not delay draws or produce public thinking/cost/event signals', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const calls = [];
  const s = runner((view, seat, opts) => new Promise(resolve => calls.push({ view, opts, resolve })));
  t.after(() => s.stop());
  const packets = []; s.listeners.add(() => packets.push(s.view(0)));
  s.schedule();
  for (let i = 0; i < 8; i++) { t.mock.timers.tick(500); await flush(); }
  assert.equal(s.state.dealt, 8); assert.equal(calls.length, 3); assert.equal(s.bidding.jobs.size, 3);
  assert.equal(packets.length, 8);
  const visible = s.view(0);
  assert.equal(visible.busy, null); assert.equal(visible.game.pending, null);
  assert.equal(visible.stats.realRequests, 0); assert.deepEqual(visible.logs, []); assert.equal(visible.game.forcedPasses, 0);
  const beforePackets = packets.length;
  calls[0].resolve({ action: { type: 'declare', choice: 'pass' }, usage: { input: 10, output: 2, cached: 0 }, ms: 100, simulated: false });
  await flush(); t.mock.timers.tick(1); await flush();
  assert.equal(packets.length, beforePackets); assert.equal(calls.length, 4);
  assert.equal(calls[3].view.hand.length, 2); assert.equal('deck' in calls[3].view, false);
  assert.equal(s.stats.realRequests, 4);
});
test('an API losing a bid race is not repaired or replaced by a peilian bid', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const state = draw(game(), 4), calls = [];
  const s = runner(view => new Promise(resolve => calls.push({ view, resolve })), state);
  t.after(() => s.stop());
  s.bidding.ensure(); s.bidding.review();
  s.human({ seat: 0, action: { type: 'declare', choice: 'S1' }, bidContext: observation(s.state, 0).bidContext });
  const before = s.state.events.length;
  calls.find(c => c.view.seat === 1).resolve({ action: { type: 'declare', choice: 'H1' }, usage: { input: 10, output: 2, cached: 0 }, ms: 1, simulated: false });
  await flush();
  assert.equal(s.state.events.length, before); assert.equal(s.state.declaration.seat, 0);
  assert.equal(s.stats.fallbacks, 0); assert.equal(s.stats.errors, 0);
  assert.equal(s.logs.filter(e => e.outcome === 'superseded').length, 1);
});
test('different hidden bid eligibility produces identical public state and packet cadence', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const pass = async () => ({ action: { type: 'declare', choice: 'pass' }, usage: { input: 10, output: 2, cached: 0 }, simulated: false, ms: 1 });
  const a = runner(pass), b = runner(pass, game(seats, [card('S', 2), card('H', 3), card('D', 3), card('C', 3)]));
  t.after(() => { a.stop(); b.stop(); });
  const packetsA = [], packetsB = [];
  a.listeners.add(() => packetsA.push(a.view(0))); b.listeners.add(() => packetsB.push(b.view(0)));
  a.schedule(); b.schedule();
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(500); await flush(); }
  assert.ok(a.stats.realRequests > b.stats.realRequests);
  assert.deepEqual(a.view(0), b.view(0)); assert.deepEqual(packetsA, packetsB);
});
test('public extensions move private closing cutoffs but never grant more than twelve seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const signals = [];
  const s = runner((view, seat, options) => { signals.push(options.signal); return new Promise(() => {}); }, draw(game(), 100));
  t.after(() => s.stop());
  s.bidding.ensure(); s.bidding.review(); assert.equal(signals.length, 3);
  t.mock.timers.tick(4000); await flush();
  s.human({ seat: 0, bidContext: observation(s.state, 0).bidContext, action: { type: 'declare', choice: 'S1' } });
  t.mock.timers.tick(1000); await flush(); assert.ok(signals.every(signal => !signal.aborted));
  t.mock.timers.tick(3000); await flush();
  s.human({ seat: 0, bidContext: observation(s.state, 0).bidContext, action: { type: 'declare', choice: 'S2' } });
  t.mock.timers.tick(3999); await flush(); assert.ok(signals.every(signal => !signal.aborted));
  t.mock.timers.tick(1); await flush(); assert.ok(signals.every(signal => signal.aborted));
  assert.equal(s.stats.fallbacks, 3); assert.equal(s.stats.usageUnknown, 3);
});
test('a restored checkpoint accounts for requests interrupted before a response', () => {
  const s = runner(() => new Promise(() => {}), draw(game(), 4));
  let checkpoint; s.persist = data => { checkpoint = structuredClone(data); };
  s.bidding.ensure(); s.bidding.review(); s.save(false);
  assert.equal(checkpoint.stats.requestsInFlight, 3);
  const restored = runner(() => {}); restored.restore(checkpoint);
  assert.equal(restored.stats.requestsInFlight, 0); assert.equal(restored.stats.usageUnknown, 3);
  s.stop(); restored.stop();
});
test('closing gets five seconds and exactly one final review per eligible context', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const calls = [];
  const s = runner(async view => { calls.push(view); return { action: { type: 'declare', choice: 'pass' }, usage: { input: 10, output: 2, cached: 0 }, simulated: false, ms: 1 }; }, draw(game(), 100));
  t.after(() => s.stop());
  for (let seat = 1; seat < 4; seat++) {
    const old = observation(s.state, seat); old.bidContext.closing = false;
    s.bidding.completed[seat] = bidKey(old);
  }
  s.schedule(); const firstClose = s.bidding.closeAt;
  assert.equal(firstClose - Date.now(), 5000);
  t.mock.timers.tick(1); await flush(); assert.equal(calls.length, 3);
  t.mock.timers.tick(2000); await flush(); assert.equal(calls.length, 3);
  s.human({ seat: 0, action: { type: 'declare', choice: 'S1' }, bidContext: observation(s.state, 0).bidContext });
  assert.equal(s.bidding.closeAt - Date.now(), 5000);
  assert.ok(s.bidding.closeAt > firstClose);
  t.mock.timers.tick(1); await flush(); assert.equal(calls.length, 6);
  t.mock.timers.tick(4999); await flush(); assert.equal(s.state.phase, 'bury');
});
test('no legal counter means no request, including after an unbeatable bid', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const prefix = [card('X', 16), card('H', 2), card('D', 2), card('C', 2), card('X', 16, 1)];
  let state = draw(game(seats, prefix), 100);
  state = bid(state, observation(state, 0), 'X4', 'human');
  let calls = 0;
  const s = runner(() => { calls++; throw Error('Unexpected call'); }, state);
  t.after(() => s.stop());
  s.schedule(); t.mock.timers.tick(4999); await flush();
  assert.equal(s.state.phase, 'closing'); assert.equal(calls, 0);
  t.mock.timers.tick(1); await flush(); assert.equal(s.state.phase, 'bury'); assert.equal(calls, 0);
});
test('a human bid received at the cutoff cannot extend or reopen the window', () => {
  const s = runner(() => {}, draw(game(), 100)); s.bidding.ensure();
  s.bidding.closeAt = Date.now();
  const before = structuredClone(s.state);
  const envelope = { seat: 0, action: { type: 'declare', choice: 'S1' }, bidContext: observation(s.state, 0).bidContext };
  s.human(envelope); assert.deepEqual(s.state, before);
  s.bidding.tick(); const closed = structuredClone(s.state);
  s.human(envelope); assert.deepEqual(s.state, closed); s.stop();
});
test('pause/restore keeps the remaining clock, cancels bids, and never allows a late action', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let checkpoint, release;
  const s = runner(view => new Promise(resolve => { release = () => resolve({ action: { type: 'declare', choice: view.options[0].id }, usage: { input: 1, output: 1, cached: 0 }, ms: 1, simulated: false }); }), draw(game(), 100));
  s.persist = data => { checkpoint = structuredClone(data); };
  s.schedule(); t.mock.timers.tick(1); await flush();
  s.pause(true); const paused = structuredClone(s.state);
  release(); await flush(); assert.deepEqual(s.state, paused);
  const restored = runner(() => new Promise(() => {})); restored.restore(checkpoint);
  t.after(() => { s.stop(); restored.stop(); });
  t.mock.timers.tick(60000); restored.pause(false);
  assert.ok(restored.bidding.closeAt - Date.now() >= 4900);
  assert.ok(restored.view(0).dealClock.closingAt > Date.now());
});
test('continuous mixed seats complete a deal with conservation; counters disclose only after completion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const players = [{ kind: 'human' }, ...[1, 2, 3].map(() => ({ kind: 'api', provider: 'mock' }))];
  const s = new Session(); s.start({ seats: players, speed: 50 }); t.after(() => s.stop());
  assert.equal(s.state.dealing, 'continuous');
  for (let i = 0; isBidding(s.state) && i < 180; i++) { t.mock.timers.tick(500); await flush(); assertConservation(s.state); }
  assert.equal(s.view(0).statsDeferred, true); assert.equal(s.view(0).stats.simulated, 0);
  let turns = 0;
  while (s.state.pending && turns++ < 150) {
    const d = s.state.pending;
    if (d.seat === 0) s.human({ decisionId: d.id, version: s.state.version, seat: d.seat, action: safeAction(observation(s.state, d.seat)) });
    else await s.step();
    clearTimeout(s.timer); assertConservation(s.state);
  }
  assert.equal(s.state.phase, 'round_over'); assert.ok(s.view(0).stats.simulated > 0);
  assert.equal(s.view(0).statsDeferred, false);
  s.next(); assert.equal(s.state.phase, 'dealing'); assert.equal(s.state.dealt, 0);
});
