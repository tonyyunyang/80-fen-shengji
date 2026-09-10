import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandDrag } from '../public/hand-drag.js';
import { dragCardIds } from '../public/hand-tools.js';

// A small event/DOM fixture exercises the controller without a browser dependency.
// Actual geometry, animation and validated game actions are checked in the browser.
function fixture({ picked = 1, reduced = false, accepted = true } = {}) {
  const animations = [], document = new EventTarget(), window = new EventTarget();
  document.defaultView = window; document.hidden = false; window.innerWidth = 1400;
  window.getComputedStyle = node => ({ transform: node.style.transform || 'none' });
  class Node extends EventTarget {
    constructor(className = '') {
      super(); this.className = className; this.style = {}; this.dataset = {};
      this.children = []; this.ownerDocument = document; this.isConnected = true;
      this.rect = { left: 50, top: 400, width: 100, height: 150 };
      this.classList = {
        contains: name => this.className.split(' ').includes(name),
        add: name => { if (!this.classList.contains(name)) this.className += ' ' + name; },
        remove: name => { this.className = this.className.split(' ').filter(n => n !== name).join(' '); },
        toggle: (name, active) => active ? this.classList.add(name) : this.classList.remove(name),
      };
    }
    append(node) { node.parent = this; this.children.push(node); }
    remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
    querySelector(selector) { return this.children.find(node => node.classList.contains(selector.slice(1))) || null; }
    setAttribute(name, value) { this[name] = value; }
    getBoundingClientRect() { return this.rect; }
    cloneNode() { const clone = new Node(this.className); clone.rect = this.rect; return clone; }
    animate(frames) {
      let finish;
      const finished = new Promise(resolve => { finish = resolve; });
      const animation = { frames, finished, finish, cancel: finish };
      animations.push(animation); return animation;
    }
  }
  document.body = new Node(); document.createElement = () => new Node();
  const root = new Node(), dropTarget = new Node();
  dropTarget.rect = { left: 150, right: 600, top: 100, bottom: 300 };
  document.getElementById = id => id === 'dropTarget' ? dropTarget : null;
  let captured;
  root.setPointerCapture = id => { captured = id; };
  root.hasPointerCapture = id => captured === id;
  root.releasePointerCapture = id => { captured = null; pointer('lostpointercapture', 0, 0, id); };
  const hand = [0, 1, 2, 3].map(id => ({ id })), selection = new Set([1, 3]);
  const nodes = hand.map(({ id }) => {
    const node = new Node('hand-slot'), face = new Node('face');
    node.dataset.card = String(id); node.rect = { left: 50 + id * 40, top: 400, width: 40, height: 150 };
    face.rect = { ...node.rect, width: 100 }; node.append(face); root.append(node); return node;
  });
  const state = { allowed: true, frozen: false, drops: [], toggles: [] };
  const hover = {
    pick: () => ({ id: picked }), element: id => nodes[id],
    freeze: () => { state.frozen = true; }, resume: () => { state.frozen = false; },
    restingRect: id => nodes[id]?.isConnected ? nodes[id].rect : null,
  };
  const drag = createHandDrag(root, {
    hover, allowed: () => state.allowed, cards: id => dragCardIds(hand, selection, id),
    toggle: id => state.toggles.push(id), drop: ids => { state.drops.push(ids); return accepted; },
    preview: ids => ({ valid: accepted, label: 'Release ' + ids.length }), reducedMotion: () => reduced,
  });
  function pointer(type, clientX = 110, clientY = 430, pointerId = 7, button = 0) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { clientX, clientY, pointerId, button, pointerType: 'mouse' }); root.dispatchEvent(event);
  }
  const ghost = () => document.body.children.find(node => node.className === 'drag-ghost');
  const finish = async () => { animations.forEach(animation => animation.finish()); await Promise.resolve(); };
  return { root, nodes, selection, state, hover, drag, pointer, ghost, finish, animations, window, document, dropTarget };
}

test('either selected physical card carries the complete selection and submits it once', async () => {
  for (const picked of [1, 3]) {
    const f = fixture({ picked });
    f.pointer('pointerdown'); f.pointer('pointermove', 240, 180);
    assert.deepEqual(f.ghost().children.filter(node => node.className === 'drag-card').map(node => Number(node.dataset.cardId)), [1, 3]);
    assert.deepEqual(f.nodes.filter(node => node.classList.contains('is-drag-source')).map(node => Number(node.dataset.card)), [1, 3]);
    assert.equal(f.dropTarget.textContent, 'Release 2');
    assert.equal(f.state.frozen, true);
    f.pointer('pointerup', 240, 180); f.pointer('pointerup', 240, 180);
    assert.deepEqual(f.state.drops, [[1, 3]]); assert.deepEqual(f.state.toggles, []);
    await f.finish(); assert.equal(f.ghost(), undefined);
    assert.ok(f.nodes.every(node => !node.classList.contains('is-drag-source')));
    f.drag.destroy();
  }
});

test('an unselected card moves alone; a click still toggles only the touched card', async () => {
  const f = fixture({ picked: 2 });
  f.pointer('pointerdown'); f.pointer('pointermove', 240, 180); f.pointer('pointerup', 240, 180);
  assert.deepEqual(f.state.drops, [[2]]); assert.deepEqual([...f.selection], [1, 3]);
  await f.finish();
  f.pointer('pointerdown'); f.pointer('pointermove', 112, 431); f.pointer('pointerup', 112, 431);
  assert.deepEqual(f.state.toggles, [2]); assert.equal(f.state.drops.length, 1); f.drag.destroy();
});

test('the group snapshot survives subsequent selection changes and unrelated pointers', () => {
  const f = fixture({ reduced: true });
  f.pointer('pointerdown'); f.selection.add(2);
  f.pointer('pointermove', 240, 180, 8); assert.equal(f.ghost(), undefined);
  f.pointer('pointermove', 240, 180); f.pointer('pointerup', 240, 180, 8);
  assert.equal(f.drag.active, true);
  f.pointer('pointerup', 240, 180); assert.deepEqual(f.state.drops, [[1, 3]]); f.drag.destroy();
});

test('cancel, outside drop and rejected groups return all sources without toggling selection', async () => {
  for (const mode of ['escape', 'pointercancel', 'lostcapture', 'blur', 'hidden', 'outside', 'invalid', 'turn-change']) {
    const f = fixture({ accepted: mode !== 'invalid' });
    f.pointer('pointerdown'); f.pointer('pointermove', 240, 180);
    if (mode === 'escape') f.drag.cancel();
    if (mode === 'pointercancel') f.pointer('pointercancel');
    if (mode === 'lostcapture') f.pointer('lostpointercapture');
    if (mode === 'blur') f.window.dispatchEvent(new Event('blur'));
    if (mode === 'hidden') { f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange')); }
    if (mode === 'outside') f.pointer('pointerup', 30, 350);
    if (mode === 'invalid') f.pointer('pointerup', 240, 180);
    if (mode === 'turn-change') { f.state.allowed = false; f.drag.refresh(); }
    f.pointer('pointerup', 240, 180);
    assert.equal(f.drag.active, false, mode); assert.equal(f.state.frozen, false, mode);
    assert.deepEqual(f.state.drops, mode === 'invalid' ? [[1, 3]] : [], mode);
    assert.deepEqual([...f.selection], [1, 3], mode); assert.deepEqual(f.state.toggles, [], mode);
    await f.finish(); assert.equal(f.ghost(), undefined, mode);
    assert.ok(f.nodes.every(node => !node.classList.contains('is-drag-source')), mode); f.drag.destroy();
  }
});

test('public redraws restore transient source marks and cannot change the held identities', () => {
  const f = fixture({ reduced: true });
  f.pointer('pointerdown'); f.pointer('pointermove', 240, 180);
  f.nodes.forEach(node => node.classList.remove('is-drag-source')); f.dropTarget.textContent = 'redrawn';
  f.drag.refresh();
  assert.deepEqual(f.nodes.filter(node => node.classList.contains('is-drag-source')).map(node => Number(node.dataset.card)), [1, 3]);
  assert.equal(f.dropTarget.textContent, 'Release 2'); assert.deepEqual(f.state.drops, []); f.drag.destroy();
});

test('a missing group member never becomes a partial play and motion can be disabled', () => {
  const f = fixture({ reduced: true });
  f.nodes[3].disabled = true; f.pointer('pointerdown');
  assert.equal(f.drag.active, false); assert.equal(f.ghost(), undefined);
  f.nodes[3].disabled = false; f.pointer('pointerdown'); f.pointer('pointermove', 240, 180);
  assert.equal(f.animations.length, 0); assert.match(f.ghost().style.transform, /rotate\(0deg\)/);
  f.drag.cancel(); assert.equal(f.ghost(), undefined); f.drag.destroy();
});

test('carried ids follow hand order, preserve duplicate faces and ignore stale selection ids', () => {
  const hand = [{ id: 56 }, { id: 2 }, { id: 8 }], selection = new Set([2, 999, 56]);
  assert.deepEqual(dragCardIds(hand, selection, 2), [56, 2]);
  assert.deepEqual(dragCardIds(hand, selection, 8), [8]);
  assert.deepEqual(dragCardIds(hand, selection, 999), []);
});

test('grabbing again during a return cannot let the previous animation reveal the new sources', async () => {
  const f = fixture();
  f.pointer('pointerdown'); f.pointer('pointermove', 240, 180); f.drag.cancel();
  f.pointer('pointerdown'); f.pointer('pointermove', 260, 170);
  await f.finish();
  assert.equal(f.drag.active, true);
  assert.equal(f.ghost().children.filter(node => node.className === 'drag-card').length, 2);
  assert.ok([1,3].every(id => f.nodes[id].classList.contains('is-drag-source')));
  f.drag.destroy();
});

test('hiding the page clears a released group even if its return animation has not finished', () => {
  const f = fixture();
  f.pointer('pointerdown'); f.pointer('pointermove', 240, 180); f.pointer('pointerup', 30, 350);
  assert.ok(f.ghost());
  f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.ghost(), undefined);
  assert.ok(f.nodes.every(node => !node.classList.contains('is-drag-source')));
  f.drag.destroy();
});

test('a viewport change cancels a valid drop even before a resize event arrives', () => {
  for (const change of ['window', 'visual-height', 'scale']) {
    const f = fixture();
    f.window.visualViewport = { width: 1400, height: 900, scale: 1 };
    f.pointer('pointerdown'); f.pointer('pointermove', 240, 180);
    if (change === 'window') f.window.innerWidth = 800;
    if (change === 'visual-height') f.window.visualViewport.height = 600;
    if (change === 'scale') f.window.visualViewport.scale = 2;
    f.pointer('pointerup', 240, 180);
    assert.deepEqual(f.state.drops, [], change);
    assert.deepEqual(f.state.toggles, [], change);
    assert.deepEqual([...f.selection], [1, 3], change);
    assert.equal(f.drag.active, false, change);
    assert.equal(f.ghost(), undefined, change);
    f.drag.destroy();
  }
});
