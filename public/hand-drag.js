// Capture the carried identities at pointer-down. Moving faces never participate
// in hit testing, and only the caller can validate/submit the complete group.
export function createHandDrag(root, {
  hover, allowed, toggle, drop, changed, cards = id => [id], preview = () => null,
  reducedMotion = () => false,
}) {
  const document = root.ownerDocument, window = document.defaultView;
  let gesture = null, ghost = null, dropBox = null;
  const returning = new Map();
  const target = () => document.getElementById('dropTarget');
  const viewport = () => [window.innerWidth, window.innerHeight, window.visualViewport?.width, window.visualViewport?.height, window.visualViewport?.scale];
  const over = (x, y) => dropBox && x >= dropBox.left && x <= dropBox.right && y >= dropBox.top && y <= dropBox.bottom;
  const transform = (x, y, angle = 0) => 'translate3d(' + x + 'px,' + y + 'px,0) rotate(' + angle + 'deg)';

  function updateTarget() {
    const node = target();
    if (!node || !gesture?.dragging) return;
    const hint = preview(gesture.ids);
    if (hint) {
      node.textContent = hint.label;
      node.dataset.dropState = hint.valid ? 'ready' : 'invalid';
    }
    dropBox = node.getBoundingClientRect();
    node.classList.toggle('over', !!over(gesture.x + gesture.dx, gesture.y + gesture.dy));
  }

  function release() {
    const current = gesture, held = ghost;
    gesture = null; ghost = null; dropBox = null;
    if (current && root.hasPointerCapture?.(current.pointerId)) root.releasePointerCapture(current.pointerId);
    document.body.classList.remove('dragging-card');
    const node = target();
    node?.classList.remove('over');
    if (node) delete node.dataset.dropState;
    hover.resume(); changed?.();
    return { current, held };
  }

  function settle(current, held, played = false, immediate = false) {
    if (!current) return;
    let cleaned = false, animation;
    const clean = () => {
      if (cleaned) return;
      cleaned = true; animation?.cancel();
      held?.remove();
      for (const item of current.items) {
        item.flight?.cancel();
        item.node.classList.remove('is-drag-source');
      }
      returning.delete(clean);
    };
    if (!held || immediate || reducedMotion() || !root.isConnected) { clean(); return; }
    returning.set(clean, current.items);
    for (const item of current.items) if (item.node.isConnected) item.node.classList.add('is-drag-source');
    held.dataset.returning = String(!played);
    held.querySelector('.drag-count')?.remove();
    const from = held.style.transform || transform(0, 0);
    if (played) {
      animation = held.animate([{ transform: from, opacity: 1 }, { transform: from + ' scale(.96)', opacity: 0 }],
        { duration: 140, easing: 'ease-out', fill: 'forwards' });
    } else {
      // The parent comes home while each card unfolds to its own resting slot.
      // Read the current animated pose so a quick release cannot snap the fan.
      for (const item of current.items) {
        const pose = window.getComputedStyle(item.ghost).transform;
        item.flight?.cancel();
        const slot = hover.restingRect(item.id);
        if (!slot) { item.ghost.remove(); continue; }
        const to = transform(slot.left - current.rect.left, slot.top - current.rect.top);
        item.ghost.style.transform = to;
        item.flight = item.ghost.animate([{ transform: pose }, { transform: to }],
          { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
      }
      animation = held.animate([{ transform: from }, { transform: transform(0, 0) }],
        { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    }
    animation.finished.then(clean, clean);
  }

  function cancel(immediate = false) {
    if (immediate) for (const clean of [...returning.keys()]) clean();
    if (!gesture) return;
    const { current, held } = release();
    settle(current, held, false, immediate);
  }

  function down(event) {
    if (event.button !== 0 || gesture || !allowed()) return;
    const hit = hover.pick(event.clientX, event.clientY), node = hit && hover.element(hit.id);
    if (!node || node.disabled) return;
    for (const clean of [...returning.keys()]) clean();
    const id = Number(node.dataset.card), ids = [...new Set(cards(id))];
    const items = ids.map(id => {
      const node = hover.element(id), face = node?.querySelector('.face');
      return face && !node.disabled ? { id, node, face, rect: face.getBoundingClientRect() } : null;
    });
    // Never silently turn a missing member into a smaller play.
    if (!ids.includes(id) || items.some(item => !item)) return;
    if (event.pointerType !== 'touch') event.preventDefault();
    gesture = { pointerId: event.pointerId, id, ids, items, rect: items.find(item => item.id === id).rect,
      viewport: viewport(), x: event.clientX, y: event.clientY, dx: 0, dy: 0, dragging: false, shift: event.shiftKey };
    hover.freeze(); root.setPointerCapture(event.pointerId);
  }

  function lift() {
    gesture.dragging = true;
    document.body.classList.add('dragging-card');
    ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.dataset.cardId = String(gesture.id);
    ghost.dataset.count = String(gesture.ids.length);
    ghost.setAttribute('aria-hidden', 'true');
    const { rect, items } = gesture, grabbed = items.findIndex(item => item.id === gesture.id);
    Object.assign(ghost.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    // A loose pair / short fan grows into a compact packet for larger groups.
    const spread = Math.max(rect.width, Math.min(window.innerWidth * .62, rect.width * 3.7));
    const step = items.length > 1 ? Math.min(rect.width * .43, (spread - rect.width) / (items.length - 1)) : 0;
    const middle = (items.length - 1) / 2;
    items.forEach((item, index) => {
      item.node.classList.add('is-drag-source');
      const card = document.createElement('div');
      card.className = 'drag-card'; card.dataset.cardId = String(item.id);
      card.style.zIndex = String(index + 1);
      card.append(item.face.cloneNode(true)); ghost.append(card); item.ghost = card;
      const angle = reducedMotion() || !middle ? 0 : (index - middle) / middle * Math.min(5, middle * 3);
      const to = transform((index - grabbed) * step, Math.abs(index - middle) / Math.max(1, middle) * rect.height * .035, angle);
      card.style.transform = to;
      if (!reducedMotion()) item.flight = card.animate([
        { transform: transform(item.rect.left - rect.left, item.rect.top - rect.top) }, { transform: to },
      ], { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
    if (items.length > 1) {
      const badge = document.createElement('span');
      badge.className = 'drag-count'; badge.textContent = String(items.length);
      badge.style.left = ((items.length - 1 - grabbed) * step + rect.width * .85) + 'px';
      ghost.append(badge);
    }
    document.body.append(ghost); updateTarget();
  }

  function move(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.dx = event.clientX - gesture.x; gesture.dy = event.clientY - gesture.y;
    if (!gesture.dragging && Math.hypot(gesture.dx, gesture.dy) > 7) lift();
    if (ghost) {
      const angle = reducedMotion() ? 0 : Math.max(-5, Math.min(5, gesture.dx * .018));
      ghost.style.transform = transform(gesture.dx, gesture.dy, angle);
      target()?.classList.toggle('over', !!over(event.clientX, event.clientY));
    }
  }

  function up(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    // Viewport metrics may change before the browser delivers its resize event.
    // Never submit against the old drop geometry in that interval.
    if (viewport().some((value, index) => value !== gesture.viewport[index])) { cancel(true); return; }
    const validTarget = gesture.dragging && over(event.clientX, event.clientY);
    const { current, held } = release();
    let played = false;
    if (allowed()) {
      if (!current.dragging) toggle(current.id, current.shift);
      else if (validTarget) played = drop([...current.ids]) === true;
    }
    settle(current, held, played);
  }

  function refresh() {
    if (gesture && (!allowed() || gesture.items.some(item => !item.node.isConnected))) cancel();
    // SSE reconciliation owns the hand's HTML; restore transient source marks.
    for (const items of [...returning.values(), ...(gesture?.dragging ? [gesture.items] : [])]) {
      for (const item of items) if (item.node.isConnected) item.node.classList.add('is-drag-source');
    }
    updateTarget();
  }

  const lost = event => { if (gesture && (event.pointerId === undefined || event.pointerId === gesture.pointerId)) cancel(); };
  const visibility = () => { if (document.hidden) cancel(true); };
  root.addEventListener('pointerdown', down); root.addEventListener('pointermove', move); root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', lost); root.addEventListener('lostpointercapture', lost);
  window.addEventListener('blur', lost); document.addEventListener('visibilitychange', visibility);
  return {
    get active() { return !!gesture; }, cancel, refresh,
    destroy() {
      cancel(true); for (const clean of [...returning.keys()]) clean();
      root.removeEventListener('pointerdown', down); root.removeEventListener('pointermove', move); root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', lost); root.removeEventListener('lostpointercapture', lost);
      window.removeEventListener('blur', lost); document.removeEventListener('visibilitychange', visibility);
    },
  };
}
