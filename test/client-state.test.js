import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptSnapshot, isHumanTurn } from '../public/client-state.js';

const snapshot = (changes = {}) => ({ csrf: 'session-a', revision: 10,
  game: { id: 'table-a', viewer: 0, version: 20 }, ...changes });

test('a delayed response for the previous player cannot replace the new viewing seat', () => {
  const previous = snapshot({ game: { id: 'table-a', viewer: 1, version: 20 } });
  assert.equal(acceptSnapshot(previous, snapshot({ revision: 11 }), 1), false);
  assert.equal(acceptSnapshot(previous, snapshot({ csrf: 'session-b' }), 1), false);
  assert.equal(acceptSnapshot(previous, { ...previous, revision: 11 }, 1), true);
});

test('the current session rejects older revisions and older versions of the same game', () => {
  const previous = snapshot();
  assert.equal(acceptSnapshot(previous, snapshot({ revision: 9 }), 0), false);
  assert.equal(acceptSnapshot(previous, snapshot({ revision: 11, game: { ...previous.game, version: 19 } }), 0), false);
  assert.equal(acceptSnapshot(previous, snapshot({ revision: 11 }), 0), true);
});

test('a new server session can restore a saved game with lower counters', () => {
  const previous = snapshot();
  const restored = snapshot({ csrf: 'session-b', revision: 1, game: { ...previous.game, version: 18 }, paused: true });
  assert.equal(acceptSnapshot(previous, restored, 0), true);
});

test('new tables, empty sessions and spectator views remain valid snapshots', () => {
  const previous = snapshot();
  assert.equal(acceptSnapshot(null, snapshot(), 0), true);
  assert.equal(acceptSnapshot(previous, snapshot({ revision: 11, game: { ...previous.game, id: 'table-b', version: 0 } }), 0), true);
  assert.equal(acceptSnapshot(null, snapshot({ game: null }), 0), true);
  assert.equal(acceptSnapshot(null, snapshot({ game: { ...previous.game, viewer: -1 } }), -1), true);
});

test('a requested bot seat uses the server spectator projection without accepting an old human view', () => {
  const previous = snapshot();
  const seats = [{ kind: 'peilian' }, { kind: 'human' }, { kind: 'peilian' }, { kind: 'peilian' }];
  const next = snapshot({ revision: 11, game: { ...previous.game, seats, viewer: -1 } });
  assert.equal(acceptSnapshot(previous, next, 0), true);
  assert.equal(acceptSnapshot(previous, next, 1), false);
});

test('only the human who owns the visible hand can operate the pending turn', () => {
  const game = { viewer: 0, pending: { seat: 0 }, seats: [{ kind: 'human' }, { kind: 'peilian' }] };
  assert.equal(isHumanTurn(game, 0), true);
  assert.equal(isHumanTurn(game, 1), false);
  assert.equal(isHumanTurn({ ...game, viewer: -1 }, 0), false);
  assert.equal(isHumanTurn({ ...game, viewer: 1, pending: { seat: 1 } }, 1), false);
  assert.equal(isHumanTurn({ ...game, pending: null }, 0), false);
});

test('an HTTP response started before a viewer or session change cannot switch the client back', () => {
  const previous = snapshot({ csrf: 'session-b' });
  const old = snapshot({ revision: 100, game: { ...previous.game, version: 100 } });
  assert.equal(acceptSnapshot(previous, old, 0, { csrf: 'session-a', viewer: 0 }), false);
  assert.equal(acceptSnapshot(previous, previous, 0, { csrf: 'session-b', viewer: 1 }), false);
  assert.equal(acceptSnapshot(previous, previous, 0, { csrf: 'session-b', viewer: 0 }), true);
});
