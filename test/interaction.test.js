import test from 'node:test';
import assert from 'node:assert/strict';
import { HumanPresence } from '../server/presence.js';
import { Session, validateConfig } from '../server/session.js';
import { createGame } from '../src/game.js';
import { makeDeck } from '../src/cards.js';
import { selectionError, selectRange, selectPair } from '../public/hand-tools.js';

const seats = [{ kind: 'human' }, ...Array.from({ length: 3 }, () => ({ kind: 'peilian' }))];
function fixture() {
  const session = new Session({ env: {} });
  session.config = validateConfig({ seats });
  session.state = createGame({ id: 'interaction', seed: 21, ...session.config });
  return session;
}
test('presence grace survives draw updates, multiple windows, and reconnects without auto-resume', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const session = fixture(), presence = new HumanPresence(session);
  t.after(() => { presence.stop(); session.stop(); });
  session.listeners.add(() => presence.check());
  const closeFirst = presence.attach(0, 'one'), closeSecond = presence.attach(0, 'two');
  presence.visibility('one', false);
  t.mock.timers.tick(6000); assert.equal(session.paused, false, 'second visible window keeps playing');
  closeSecond();
  for (let i = 0; i < 9; i++) { t.mock.timers.tick(500); presence.check(); }
  assert.equal(session.paused, false);
  t.mock.timers.tick(500); assert.equal(session.paused, true); assert.equal(session.pauseReason, 'away');
  presence.visibility('one', true); assert.equal(session.paused, true, 'return needs explicit resume');
  session.pause(false); closeFirst();
  t.mock.timers.tick(4000); const closeThird = presence.attach(0, 'three');
  t.mock.timers.tick(2000); assert.equal(session.paused, false, 'quick reconnect cancels the pause');
  closeThird(); t.mock.timers.tick(5000); assert.equal(session.paused, true);
});
test('spectators and headless games never activate a human presence timeout', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const session = fixture(), presence = new HumanPresence(session);
  t.after(() => { presence.stop(); session.stop(); });
  presence.attach(-1, 'spectator')(); presence.check(); t.mock.timers.tick(6000);
  assert.equal(session.paused, false);
  presence.attach(0, 'old-human')();
  session.state.id = 'new-headless-table'; presence.check(); t.mock.timers.tick(6000);
  assert.equal(session.paused, false, 'an old viewer cannot pause a new game');
});
test('zero API allowance stays zero and uses preserved fallback; invalid numeric settings fail atomically', async () => {
  let calls = 0;
  const apiSeats = Array.from({ length: 4 }, () => ({ kind: 'api', provider: 'qwen', model: 'qwen3.8-flash' }));
  const session = new Session({ env: { QWEN_API_KEY: 'fixture', QWEN_BASE_URL: 'https://example.invalid/v1' }, providerCall: () => { calls++; throw new Error('must not call'); } });
  session.config = validateConfig({ seats: apiSeats, dealing: 'ordered', limits: { maxRequests: 0 } }, { qwen: true });
  session.state = createGame({ id: 'zero-cost', seed: 21, ...session.config });
  try {
    await session.step();
    assert.equal(calls, 0); assert.equal(session.config.limits.maxRequests, 0); assert.equal(session.state.lastAction.source, 'fallback');
    const before = session.state;
    for (const invalid of ['nonsense', Infinity, NaN, false, [], {}]) {
      assert.throws(() => session.start({ seats, limits: { timeoutMs: invalid } }), /有效数字/);
      assert.equal(session.state, before);
    }
    assert.equal(validateConfig({ seats, limits: { maxRequests: 3.9 } }).limits.maxRequests, 3);
  } finally { session.stop(); }
});
test('damaged checkpoints cannot replace a running table or corrupt usage', () => {
  const session = fixture(), before = session.state;
  try {
    const corrupted = structuredClone(before); corrupted.deck.pop();
    assert.throws(() => session.restore({ state: corrupted, config: session.config }));
    assert.equal(session.state, before);
    const wrongFace = structuredClone(before); wrongFace.deck[0].rank = 999;
    assert.throws(() => session.restore({ state: wrongFace, config: session.config }), /identity/);
    assert.equal(session.state, before);
    assert.throws(() => session.restore({ state: before, config: session.config, stats: { latency: null } }), /用量/);
    assert.equal(session.state, before);
    assert.throws(() => session.restore({ state: before, config: session.config, dealClock: { completed: [], closingRemaining: 'bad' } }));
    assert.equal(session.state, before);
    session.setAutoplay(0, true);
    assert.throws(() => session.human({ seat: 0, action: { type: 'declare', choice: 'pass' } }), /收回托管/);
  } finally { session.stop(); }
});
test('selection guidance enforces burial, effective suits and forced pairs using only the visible hand', () => {
  const deck = makeDeck(), trump = { suit: 'H', rank: 2 };
  const pair = deck.filter(c => c.suit === 'S' && c.rank === 5);
  const singles = deck.filter(c => c.suit === 'S' && [6, 7].includes(c.rank) && c.id < 54);
  const hand = [...pair, ...singles, ...deck.filter(c => c.suit === 'H').slice(0, 5)];
  const game = { hand, trump, pending: { phase: 'follow' }, plays: [{ cards: pair }], rules: {} };
  assert.match(selectionError(game, singles.map(c => c.id)), /对子/);
  assert.equal(selectionError(game, pair.map(c => c.id)), null);
  assert.match(selectionError(game, [pair[0].id, pair[0].id]), /不重复/);
  game.pending.phase = 'bury';
  assert.match(selectionError(game, hand.slice(0, 7).map(c => c.id)), /差 1/);
  assert.equal(selectionError(game, hand.slice(0, 8).map(c => c.id)), null);
  game.pending.phase = 'lead';
  assert.match(selectionError(game, [pair[0].id, hand.at(-1).id]), /同一有效花色/);
  assert.deepEqual([...selectPair(hand, new Set(), pair[0].id)], pair.map(c => c.id));
  assert.deepEqual([...selectRange(hand, new Set(), hand[3].id, hand[1].id)], hand.slice(1, 4).map(c => c.id));
});
