import test from 'node:test';
import assert from 'node:assert/strict';
import { TrickFlow, TRICK_TIMING, tableFacts } from '../public/table-flow.js';

const snapshot = (tricks = [], changes = {}) => ({
  id: 'table', viewer: 0, events: [{ type: 'deal_started', seq: 0 }],
  tricks, plays: [], match: { levels: [2, 2], dealer: 0 }, dealer: 0,
  trump: { rank: 2, suit: 'H' }, trumpRank: 2, ...changes,
});
const trick = (index, winner = 1) => ({ index, winner, points: 0, plays: [0, 1, 2, 3].map(seat => ({ seat, cards: [{ id: seat }] })) });

test('completed tricks stay visible, flip, then collect even when the next lead arrives immediately', () => {
  const flow = new TrickFlow(), start = snapshot();
  flow.update(start, { now: 0 });
  const completed = snapshot([trick(0)]);
  const original = structuredClone(completed);
  let view = flow.update(completed, { now: 100 });
  assert.equal(view.phase, 'hold'); assert.equal(view.trick.plays.length, 4);
  completed.plays = [{ seat: 1, cards: [{ id: 20 }] }];
  view = flow.update(completed, { now: 500 });
  assert.equal(view.phase, 'hold'); assert.equal(view.trick.plays.length, 4);
  view = flow.update(completed, { now: 100 + TRICK_TIMING.hold });
  assert.equal(view.phase, 'flip'); assert.equal(view.trick.winner, 1);
  view = flow.update(completed, { now: 100 + TRICK_TIMING.hold + TRICK_TIMING.flip });
  assert.equal(view.phase, 'collect'); assert.equal(view.trick.points, 0);
  assert.equal(flow.update(completed, { now: 1700 }), null);
  assert.deepEqual(completed.tricks, original.tricks, 'presentation never mutates authoritative public records');
});

test('reload, pause, reduced motion and a new deal never replay an old collection', () => {
  const flow = new TrickFlow(), old = snapshot([trick(0)]);
  assert.equal(flow.update(old, { now: 0 }), null, 'a reload starts at the current table');
  const next = snapshot([trick(0), trick(1)]);
  assert.ok(flow.update(next, { now: 100 }));
  assert.equal(flow.update(next, { now: 200, paused: true }), null);
  assert.equal(flow.update(next, { now: 300 }), null, 'resume does not replay');
  assert.equal(flow.update(snapshot([trick(0), trick(1), trick(2)]), { now: 400, reducedMotion: true }), null);
  assert.equal(flow.update(snapshot([], { events: [{ type: 'deal_started', seq: 99 }] }), { now: 500 }), null);
  assert.equal(flow.update(snapshot([trick(0)], { id: 'replacement' }), { now: 600 }), null);
});

test('rapid updates coalesce to the latest public trick without an animation backlog', () => {
  const flow = new TrickFlow();
  flow.update(snapshot(), { now: 0 });
  flow.update(snapshot([trick(0)]), { now: 100 });
  const latest = snapshot(Array.from({ length: 8 }, (_, i) => trick(i, i % 4)));
  assert.equal(flow.update(latest, { now: 300 }).trick.index, 7);
  assert.equal(flow.update(latest, { now: 300, hidden: true }), null);
  assert.equal(flow.update(latest, { now: 600 }), null);
});

test('the fixed info bar uses the current deal level, including after advancement and in no-trump', () => {
  const facts = tableFacts(snapshot([trick(0)], { score: {}, match: { levels: [5, 2], dealer: 2 } }));
  assert.equal(facts.rank, 2); assert.equal(facts.suitName, '红桃主'); assert.equal(facts.last.points, 0);
  assert.equal(tableFacts(snapshot([], { trump: { rank: 10, suit: null } })).suitName, '无主');
  const contested = snapshot([], { trump: null, declaration: null, dealer: -1, match: { levels: [5, 2], dealer: -1 } });
  assert.equal(tableFacts(contested).rank, null); assert.equal(tableFacts(contested).suitName, '待亮主');
  contested.declaration = { seat: 0, suit: 'S' }; contested.trumpRank = 5;
  assert.equal(tableFacts(contested).rank, 5); assert.equal(tableFacts(contested).suitLabel, '当前亮主');
  assert.equal(tableFacts(contested).dealer, 0);
});

test('a redeal with a new dealer contest does not reuse the previous dealer level or label',()=>{
  const game={tricks:[],trump:null,declaration:null,trumpRank:3,dealer:-1,dealerKnown:false,match:{dealer:0,levels:[3,5]}};
  assert.equal(tableFacts(game).rank,null);
  const bid=tableFacts({...game,declaration:{seat:1,suit:'H'},trumpRank:5});
  assert.equal(bid.rank,5);assert.match(bid.dealerLabel,/暂定|provisional/i);
});
