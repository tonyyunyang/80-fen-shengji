import {isPlayIntent} from './play-intent.js';

// Capture carried identities on press. Hover uses stable targets; a returning
// ghost can be re-grabbed at its painted pose. The caller validates the group.
export function createHandDrag(root, {
  hover, allowed, toggle, drop, changed, cards = id => [id], preview = () => null,
  reducedMotion = () => false,
}) {
  const document = root.ownerDocument, window = document.defaultView;
  let gesture = null, ghost = null, dropBox = null;
  const returning = new Map();
  const target = () => document.getElementById('dropTarget');
  const viewport = () => [window.innerWidth, window.innerHeight, window.visualViewport?.width, window.visualViewport?.height, window.visualViewport?.scale];
  const over = (x, y) => gesture && isPlayIntent(gesture.intentRect,x-gesture.x,y-gesture.y,dropBox,gesture.over);
  const transform = (x, y, angle = 0) => 'translate3d(' + x + 'px,' + y + 'px,0) rotate(' + angle + 'deg)';
  const angleOf=node=>{
    const values=window.getComputedStyle(node).transform.match(/^matrix(?:3d)?\(([^)]+)\)$/)?.[1].split(',').map(Number);
    return values?Math.atan2(values[1],values[0])*180/Math.PI:0;
  };
  function handBack(items,held){
    if(!hover.adoptPoses||!held?.isConnected||!root.isConnected||reducedMotion()||document.hidden)return;
    const parentAngle=angleOf(held);
    hover.adoptPoses(items.filter(item=>item.node.isConnected&&item.ghost?.isConnected).map(item=>{
      const rect=item.ghost.getBoundingClientRect();
      return {id:item.id,left:rect.left,top:rect.top,width:rect.width,height:rect.height,angle:parentAngle+angleOf(item.ghost)};
    }));
  }

  function updateTarget() {
    const node = target();
    if (!node || !gesture?.dragging) return;
    const hint = preview(gesture.ids);
    if (hint) {
      node.textContent = hint.label;
      node.dataset.dropState = hint.valid ? 'ready' : 'invalid';
    }
    dropBox = node.getBoundingClientRect();
    gesture.over=!!over(gesture.x + gesture.dx, gesture.y + gesture.dy);
    node.classList.toggle('over',gesture.over);
    if(ghost&&hint){
      ghost.dataset.dropState=hint.valid?'ready':'invalid';ghost.dataset.over=String(gesture.over);
      ghost.querySelector('.drag-hint').textContent=gesture.over?hint.label:hint.guide||hint.label;
    }
  }

  function release(point = null) {
    const current = gesture, held = ghost;
    gesture = null; ghost = null; dropBox = null;
    if (current && root.hasPointerCapture?.(current.pointerId)) root.releasePointerCapture(current.pointerId);
    document.body.classList.remove('dragging-card');
    const node = target();
    node?.classList.remove('over');
    if (node) delete node.dataset.dropState;
    hover.resume(point); changed?.();
    return { current, held };
  }

  function settle(current, held, played = false, immediate = false) {
    if (!current) return;
    let cleaned = false, animation;
    const remaining=()=>current.items.filter(item=>!item.taken);
    const clean = (transfer = true) => {
      if (cleaned) return;
      cleaned = true;
      if(transfer&&!played&&!immediate)handBack(remaining(),held);
      animation?.cancel();
      held?.remove();
      for (const item of remaining()) {
        item.flight?.cancel();
        item.node.classList.remove('is-drag-source');
      }
      returning.delete(clean);
    };
    clean.take=ids=>{
      const taken=remaining().filter(item=>ids.includes(item.id));
      handBack(taken,held);
      for(const item of taken){item.taken=true;item.flight?.cancel();item.ghost?.remove();item.node.classList.remove('is-drag-source');}
      const rest=remaining();if(rest.length)returning.set(clean,rest);else clean(false);
    };
    if (!held || immediate || reducedMotion() || !root.isConnected) { clean(); return; }
    returning.set(clean, current.items);
    for (const item of current.items) if (item.node.isConnected) item.node.classList.add('is-drag-source');
    held.dataset.returning = String(!played);
    held.querySelector('.drag-count')?.remove();
    held.querySelector('.drag-hint')?.remove();
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
    if (immediate) for (const clean of [...returning.keys()]) clean(false);
    if (!gesture) return;
    const { current, held } = release();
    settle(current, held, false, immediate);
  }

  function down(event) {
    if (event.button !== 0 || gesture || !allowed()) return;
    let hit=null;
    // A returning card can be grabbed at its visible position. These geometry
    // reads occur only on a press, never during continuous hover picking.
    for(const items of [...returning.values()].reverse()){
      for(const item of [...items].reverse()){
        const r=item.ghost?.isConnected&&item.ghost.getBoundingClientRect();
        if(r&&event.clientX>=r.left&&event.clientX<=r.left+r.width&&event.clientY>=r.top&&event.clientY<=r.top+r.height){hit={id:item.id};break;}
      }
      if(hit)break;
    }
    hit ||= hover.pick(event.clientX, event.clientY);
    const node = hit && hover.element(hit.id);
    if (!node || node.disabled) return;
    const id = Number(node.dataset.card), ids = [...new Set(cards(id))];
    // Re-grabbing one member must not teleport the other returning cards or
    // let an older animation later reveal a card held by the new gesture.
    for(const [clean,items] of returning)if(items.some(item=>ids.includes(item.id)))clean.take(ids);
    const items = ids.map(id => {
      const node = hover.element(id), face = node?.querySelector('.face');
      return face && !node.disabled ? { id, node, face, rect: face.getBoundingClientRect() } : null;
    });
    // Never silently turn a missing member into a smaller play.
    if (!ids.includes(id) || items.some(item => !item)) return;
    if (event.pointerType !== 'touch') event.preventDefault();
    const rect=items.find(item=>item.id===id).rect;
    const selectedTarget=node.getAttribute?.('aria-pressed')==='true'?hover.restingRect(id):null;
    // Keep the painted pickup pose, but don't make a just-selected card harder
    // to play merely because its lift has not finished yet.
    // DOMRect dimensions are prototype getters, not enumerable properties.
    const intentRect=selectedTarget?{left:rect.left,top:Math.min(rect.top,selectedTarget.top),width:rect.width,height:rect.height}:rect;
    gesture = { pointerId: event.pointerId, id, ids, items, rect, intentRect,
      pointerType: event.pointerType, viewport: viewport(), x: event.clientX, y: event.clientY, dx: 0, dy: 0, dragging: false, shift: event.shiftKey };
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
    const hint=document.createElement('span');hint.className='drag-hint';ghost.append(hint);
    document.body.append(ghost); updateTarget();
  }

  function move(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.dx = event.clientX - gesture.x; gesture.dy = event.clientY - gesture.y;
    // A horizontal touch belongs to the hand's native scroll area. Releasing
    // capture before lifting prevents a swipe from flashing a dragged card or
    // selecting it on release. Vertical drags retain the existing play gesture.
    if (!gesture.dragging && gesture.pointerType === 'touch' && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy)) { cancel(true); return; }
    if (!gesture.dragging && Math.hypot(gesture.dx, gesture.dy) > (gesture.pointerType === 'touch' ? 10 : 7)) lift();
    if (ghost) {
      const angle = reducedMotion() ? 0 : Math.max(-5, Math.min(5, gesture.dx * .018));
      ghost.style.transform = transform(gesture.dx, gesture.dy, angle);
      updateTarget();
    }
  }

  function up(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    // Viewport metrics may change before the browser delivers its resize event.
    // Never submit against the old drop geometry in that interval.
    if (viewport().some((value, index) => value !== gesture.viewport[index])) { cancel(true); return; }
    const validTarget = gesture.dragging && over(event.clientX, event.clientY);
    const clickPoint=!gesture.dragging?{x:event.clientX,y:event.clientY,id:gesture.id,pointerType:gesture.pointerType}:null;
    const { current, held } = release(clickPoint);
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
