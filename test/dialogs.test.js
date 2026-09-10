import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissDialog, bindBackdropDismissal } from '../public/dialogs.js';

function fixture() {
  const dialog = new EventTarget();
  dialog.open = true;
  const key = { value: 'fixture-password' };
  dialog.querySelectorAll = () => [key];
  dialog.getBoundingClientRect = () => ({ left: 100, right: 500, top: 100, bottom: 600 });
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };
  const pointer = (type, x, id = 1, button = 0) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { clientX: x, clientY: 250, pointerId: id, button });
    dialog.dispatchEvent(event);
  };
  return { dialog, key, pointer };
}

test('dismissal clears passwords synchronously and preserves native cancel semantics', () => {
  const { dialog, key } = fixture();
  dialog.requestClose = () => { assert.equal(key.value, ''); dialog.close(); };
  dismissDialog(dialog);
  assert.equal(dialog.open, false);
  const legacy = fixture();
  legacy.dialog.addEventListener('cancel', event => event.preventDefault());
  dismissDialog(legacy.dialog);
  assert.equal(legacy.dialog.open, true, 'a cancel handler can handle pause/resume itself');
  assert.equal(legacy.key.value, '');
});

test('backdrop requires the same primary gesture to begin and end outside', () => {
  const { dialog, pointer } = fixture();
  bindBackdropDismissal(dialog);
  pointer('pointerdown', 150); pointer('pointerup', 50);
  assert.equal(dialog.open, true, 'text selection dragged out must not dismiss');
  pointer('pointerdown', 50); pointer('pointerup', 150);
  assert.equal(dialog.open, true);
  pointer('pointerdown', 50, 1); pointer('pointerup', 50, 2);
  assert.equal(dialog.open, true, 'a second touch must not finish the first gesture');
  pointer('pointerdown', 50, 1, 2); pointer('pointerup', 50, 1, 2);
  assert.equal(dialog.open, true, 'context click is not dismissal');
  pointer('pointerdown', 50); pointer('pointerup', 50);
  assert.equal(dialog.open, false);
});

test('cancelled pointers and closed dialogs cannot retain a dismissal gesture', () => {
  const { dialog, pointer } = fixture();
  bindBackdropDismissal(dialog);
  pointer('pointerdown', 50); pointer('pointercancel', 50); pointer('pointerup', 50);
  assert.equal(dialog.open, true);
  pointer('pointerdown', 50); dialog.close(); dialog.open = true; pointer('pointerup', 50);
  assert.equal(dialog.open, true);
});
