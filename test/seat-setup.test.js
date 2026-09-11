import test from 'node:test';
import assert from 'node:assert/strict';
import { setupSeatRows } from '../public/seat-setup.js';
import { relativePosition } from '../public/pixel-view.js';

test('setup groups teammates in every human perspective without moving seat settings', () => {
  for (let viewer = 0; viewer < 4; viewer++) {
    const seats = Array.from({ length: 4 }, (_, index) =>
      Object.freeze({
        kind: index === viewer ? 'human' : index % 2 ? 'api' : 'peilian',
        model: 'model-' + index,
      }),
    );
    const before = structuredClone(seats);
    const rows = setupSeatRows(Object.freeze(seats));
    assert.deepEqual(
      rows.map((row) => row.index),
      [viewer, (viewer + 2) % 4, (viewer + 3) % 4, (viewer + 1) % 4],
    );
    assert.deepEqual(
      rows.map((row) => row.team),
      [0, 0, 1, 1],
    );
    for (const row of rows) {
      assert.equal(row.position, relativePosition({ viewer }, row.index));
      assert.equal(seats[row.index].model, 'model-' + row.index);
    }
    assert.deepEqual(seats, before);
  }
});

test('shared-device setup uses the same first human as the initial table view', () => {
  const seats = ['api', 'human', 'peilian', 'human'].map((kind) => ({ kind }));
  assert.deepEqual(
    setupSeatRows(seats).map((row) => row.index),
    [1, 3, 0, 2],
  );
  seats[0].kind = 'human';
  assert.deepEqual(
    setupSeatRows(seats).map((row) => row.index),
    [0, 2, 3, 1],
  );
});

test('spectator setup labels two partnerships without claiming a human seat', () => {
  const rows = setupSeatRows(['peilian', 'api', 'peilian', 'api'].map((kind) => ({ kind })));
  assert.deepEqual(
    rows.map((row) => row.index),
    [0, 2, 3, 1],
  );
  assert.equal(rows[0].label, rows[1].label);
  assert.equal(rows[2].label, rows[3].label);
  assert.notEqual(rows[0].label, rows[2].label);
  assert.equal(new Set(rows.map((row) => row.hint)).size, 4);
  assert.equal(
    rows.some((row) => row.label === '你'),
    false,
  );
});
