import test from 'node:test';
import assert from 'node:assert/strict';
import { EffectFlow } from '../public/effect-flow.js';
import { readPreferences } from '../public/preferences.js';

const game = (events = [], changes = {}) => ({ id: 'effects', viewer: 0, dealt: 100, phase: 'play',
  events: [{ seq: 0, type: 'deal_started' }, ...events], dealer: 0,
  match: { winner: -1 }, ...changes });
const play = (seq, seat = 1, trick = 0) => ({ seq, type: 'play', seat, trick, cards: [{ id: 12 }] });
const trick = (seq, index = 0) => ({ seq, type: 'trick', index, winner: 1, points: 20 });

test('effects do not replay history after initial load, replacement, redeal or viewer change', () => {
  const flow = new EffectFlow(), old = game([play(1), trick(2)]);
  assert.deepEqual(flow.update(old), []);
  assert.deepEqual(flow.update(old), []);
  assert.deepEqual(flow.update({ ...old, id: 'other' }), []);
  assert.deepEqual(flow.update({ ...old, viewer: 2 }), []);
  assert.deepEqual(flow.update(game([{ seq: 8, type: 'deal_started' }, play(9)])), []);
});

test('only an explicit public-event allowlist can produce a visual or sonic cue', () => {
  const flow = new EffectFlow(); flow.update(game());
  const next = game([
    { seq: 1, type: 'draw', seat: 2, card: { id: 19 } },
    { seq: 2, type: 'buried', seat: 0, cards: [1, 2] },
    { seq: 3, type: 'decision_applied', source: 'api' },
    { seq: 4, type: 'pass', seat: 1 },
    { seq: 5, type: 'play', audience: 1, seat: 1, cards: [] },
  ], { pending: { seat: 2, options: ['eligible'] }, busy: { api: true }, usage: { requests: 21 } });
  assert.deepEqual(flow.update(next), []);
  assert.deepEqual(flow.update({ ...next, pending: null, busy: null }), []);
  const declaration = { seq: 6, type: 'declaration', seat: 2, suit: 'H', strength: 2 };
  assert.deepEqual(flow.update(game([...next.events.slice(1), declaration])), [{ type: 'declaration', seat: 2, suit: 'H', strength: 2 }]);
});

test('public dealt counts produce at most one paper sound per snapshot', () => {
  const flow = new EffectFlow(); flow.update(game([], { phase: 'dealing', dealt: 4 }));
  assert.deepEqual(flow.update(game([], { phase: 'dealing', dealt: 20 })), [{ type: 'deal' }]);
  assert.deepEqual(flow.update(game([], { phase: 'dealing', dealt: 20 })), []);
  assert.deepEqual(flow.update(game([], { phase: 'play', dealt: 100 })), []);
});

test('fast public updates coalesce without mutating their source or queuing a backlog', () => {
  const flow = new EffectFlow(); flow.update(game());
  const next = game([play(1), trick(2), play(3, 2, 1), trick(4, 1)]), before = structuredClone(next);
  assert.deepEqual(flow.update(next), [
    { type: 'play', seat: 2, index: 1, count: 1 }, { type: 'capture', index: 1, winner: 1, points: 20 },
  ]);
  assert.deepEqual(flow.update(next), []); assert.deepEqual(next, before);
});

test('collection uses the existing presentation clock and emits once for a trick', () => {
  const flow = new EffectFlow(), current = game([trick(1)]); flow.update(current);
  const motion = { key: 'effects:0', phase: 'hold', trick: { index: 0, winner: 1, points: 20 } };
  assert.deepEqual(flow.update(current, { motion }), []);
  assert.equal(flow.update(current, { motion: { ...motion, phase: 'collect' } })[0].type, 'collect');
  assert.deepEqual(flow.update(current, { motion: { ...motion, phase: 'collect' } }), []);
});

test('round celebration waits for collection; its team and total are authoritative', () => {
  const flow = new EffectFlow(); flow.update(game());
  const scored = game([trick(1), { seq: 2, type: 'round_scored' }], { score: { total: 100, attackersWin: true } });
  const motion = { key: 'effects:0', phase: 'hold', trick: { index: 0, winner: 1, points: 20 } };
  assert.deepEqual(flow.update(scored, { motion }).map(cue => cue.type), ['capture']);
  assert.deepEqual(flow.update(scored), [{ type: 'result', total: 100, winner: 1, complete: false }]);
  assert.deepEqual(flow.update(scored), []);
});

test('hidden and paused updates are consumed, including a pending ceremony', () => {
  const flow = new EffectFlow(); flow.update(game());
  const scored = game([play(1), trick(2), { seq: 3, type: 'round_scored' }], { score: { total: 65, attackersWin: false } });
  flow.update(scored, { motion: { key: 'last', phase: 'hold' } });
  assert.deepEqual(flow.update(scored, { active: false }), []);
  assert.deepEqual(flow.update(scored), [], 'resume does not replay the result');
  const newer = game([...scored.events.slice(1), play(4)]);
  assert.deepEqual(flow.update(newer, { active: false }), []);
  assert.deepEqual(flow.update(newer), [], 'unseen play sounds are discarded');
});

test('closing an overlay does not replay the collection it covered', () => {
  const flow = new EffectFlow(), current = game([trick(1)]); flow.update(current);
  const motion = { key: 'covered', phase: 'hold', trick: { index: 0, winner: 1, points: 20 } };
  flow.update(current, { active: false, motion });
  assert.deepEqual(flow.update(current, { motion: { ...motion, phase: 'collect' } }), []);
});

test('effect preferences migrate safely and reject unsupported settings', () => {
  assert.equal(readPreferences({}).effects, 'full');
  for (const effects of ['full', 'soft', 'off']) assert.equal(readPreferences({ effects }).effects, effects);
  assert.equal(readPreferences({ effects: 'unlimited' }).effects, 'full');
  assert.equal(readPreferences({ motion: false, effects: 'full' }).motion, false);
});
