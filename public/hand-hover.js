// Geometry stays attached to the resting card slots. Animated card faces never
// participate in picking, so raising a card cannot steal its neighbour's input.
export function makeHoverRows(items) {
  const rows = [];
  for (const item of [...items].sort((a, b) => a.top - b.top || a.left - b.left)) {
    let row = rows.find(candidate => Math.abs(candidate.top - item.top) < Math.min(28, item.height * .3));
    if (!row) { row = { top: item.top, bottom: item.top + item.height, items: [] }; rows.push(row); }
    row.top = Math.min(row.top, item.top);
    row.bottom = Math.max(row.bottom, item.top + item.height);
    row.items.push(item);
  }
  rows.sort((a, b) => a.top - b.top);
  for (const row of rows) {
    row.items.sort((a, b) => a.left - b.left);
    row.left = row.items[0].left;
    row.right = Math.max(...row.items.map(item => item.left + item.width));
    row.edges = row.items.map((item, i) => {
      if (!i) return item.left;
      const previousRight = row.items[i - 1].left + row.items[i - 1].width;
      return previousRight < item.left ? (previousRight + item.left) / 2 : item.left;
    });
    row.edges.push(row.right);
  }
  return rows;
}

export function pickHover(rows, x, y, previous = null, { hysteresis = 1.5, lift = 44, selectedLift = 0 } = {}) {
  let rowIndex = -1;
  // A front row owns its entire resting strip. The raised back row cannot
  // capture the front row's cards when the pointer moves vertically.
  for (let i = rows.length - 1; i >= 0; i--) {
    if (y >= rows[i].top && y <= rows[i].bottom + 5) { rowIndex = i; break; }
  }
  // Selected cards have a stable exposed strip above their slots. It remains
  // clickable from outside the hand, without first hovering an unselected card.
  if(rowIndex<0&&selectedLift>0){
    for(let i=rows.length-1;i>=0;i--){
      const row=rows[i];if(y<row.top-selectedLift||y>=row.top)continue;
      for(let index=row.items.length-1;index>=0;index--){
        const item=row.items[index];
        if(item.isSelected&&x>=item.left&&x<=item.left+(item.faceWidth??item.width))return {id:item.id,row:i,index,coordinate:index,x,y};
      }
    }
  }
  if (rowIndex < 0 && previous) {
    const i = rows.findIndex(row => row.items.some(item => item.id === previous.id));
    if (i >= 0 && y >= rows[i].top - lift && y < rows[i].top) rowIndex = i;
  }
  if (rowIndex < 0) return null;
  const row = rows[rowIndex];
  if (x < row.left - 2 || x > row.right + 2) return null;
  let index = row.items.length - 1;
  for (let i = 0; i < row.items.length - 1; i++) if (x < row.edges[i + 1]) { index = i; break; }
  const previousIndex = previous && row.items.findIndex(item => item.id === previous.id);
  let active = index;
  if (Number.isInteger(previousIndex) && previousIndex >= 0 && Math.abs(previousIndex - index) === 1) {
    const edge = row.edges[Math.max(previousIndex, index)];
    if (Math.abs(x - edge) < hysteresis) active = previousIndex;
  }
  const width = Math.max(1, row.edges[index + 1] - row.edges[index]);
  const coordinate = index + Math.max(0, Math.min(1, (x - row.edges[index]) / width)) - .5;
  return { id: row.items[active].id, row: rowIndex, index: active, coordinate, x, y };
}

// Time-based exponential approach: monotonic, continuous across target changes,
// and equally quick on 60/120/144 Hz displays. No overshoot or CSS restart.
export function approach(current, target, elapsedMs, timeConstant = 32) {
  return target + (current - target) * Math.exp(-Math.max(0, elapsedMs) / timeConstant);
}

// Exact critically damped motion. A rapid toggle keeps its current position
// and velocity, instead of restarting a CSS keyframe or teleporting to a pose.
export function settleSelection(position,velocity,target,elapsedMs,frequency=30){
  const dt=Math.max(0,elapsedMs)/1000,offset=position-target,momentum=velocity+frequency*offset,decay=Math.exp(-frequency*dt);
  return {position:target+(offset+momentum*dt)*decay,velocity:(velocity-frequency*momentum*dt)*decay};
}

const spreadOffset=(row,index,activeIndex)=>{
  const width=row.items[index].faceWidth??row.items[index].width;
  const spacing=row.items.length>1?row.items[1].left-row.items[0].left:width;
  return Math.sign(index-activeIndex)*Math.max(0,width-spacing+5);
};
export function spreadHoverRows(rows,active){
  if(!active)return rows;
  return rows.map((row,rowIndex)=>rowIndex!==active.row?row:makeHoverRows(row.items.map((item,index)=>({...item,width:item.faceWidth??item.width,left:item.left+spreadOffset(row,index,active.index)})))[0]);
}

// A newly dealt card can move an existing identity to a different slot. The
// reading fan must not keep using that identity's index from the previous hand.
export function anchorHover(rows, active) {
  if (!active) return null;
  const row = rows.findIndex(item => item.items.some(card => card.id === active.id));
  if (row < 0) return null;
  const index = rows[row].items.findIndex(card => card.id === active.id);
  return { ...active, row, index, coordinate: index + Math.max(-.5, Math.min(.5, active.coordinate - active.index)) };
}

export function createHandHover(root, {
  items = () => [...root.children],
  visual = item => item.firstElementChild,
  identity = item => item.dataset.card ?? item.dataset.id,
  selected = item => item.getAttribute('aria-pressed') === 'true',
  blocked = () => false,
  lift = 34,
  selectedLift = 20,
  spread = false,
  reducedMotion = () => false,
  clipToRoot = false,
  transformPriority = '',
  onChange = () => {},
  onFrame = null,
} = {}) {
  const document = root.ownerDocument, window = document.defaultView;
  const hoverLift=()=>typeof lift==='function'?lift():lift;
  const selectionLift=()=>typeof selectedLift==='function'?selectedLift():selectedLift;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let entries = [], rows = [], active = null, pointer = null, keyboard = false, bounds = null;
  let frame = 0, previousTime = null, frozen = false, disposed = false, dirty = true, sceneScale = 1;
  const metrics = { frames: 0, layoutReads: 0, pointerEvents: 0, maxRenderMs: 0 };
  root.dataset.handHover = 'true';
  const schedule = () => { if (!frame && !frozen && !disposed && !document.hidden) frame = window.requestAnimationFrame(tick); };
  function change(next) {
    // Public state reconciliation may remove renderer-owned attributes while
    // leaving the same card active. Restore the pose marker without a relayout.
    if (next && root.dataset.hoveredCard !== String(next.id)) root.dataset.hoveredCard = String(next.id);
    else if (!next) delete root.dataset.hoveredCard;
    if (!next && !active) return;
    if (next && active && next.id === active.id && next.row === active.row && next.index === active.index && Math.abs(next.coordinate - active.coordinate) < .0001) return;
    const changed = next?.id !== active?.id;
    active = next;
    if (changed) {
      if (active) root.dataset.hoveredCard = String(active.id); else delete root.dataset.hoveredCard;
      onChange(active?.id ?? null, active);
    }
    schedule();
  }
  function measure() {
    if (clipToRoot || root.clientWidth > 0) {
      const rect = root.getBoundingClientRect(); metrics.layoutReads++;
      sceneScale = root.clientWidth > 0 ? rect.width / root.clientWidth : 1;
      bounds = clipToRoot ? rect : null;
    }
    const previous = new Map(entries.map(entry => [entry.element, entry]));
    entries = items().filter(element => element.isConnected && element.getClientRects().length).map(element => {
      const rect = element.getBoundingClientRect(), old = previous.get(element), face = visual(element);
      metrics.layoutReads++;
      return { element, face, id: identity(element), left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        x: old?.x ?? 0, y: old?.y ?? (selected(element) ? -selectionLift() : 0), angle: old?.angle ?? 0,
        isSelected:old?.isSelected??selected(element),selectionMoving:old?.selectionMoving??false,velocityY:old?.velocityY??0,
        faceWidth: spread && face ? face.offsetWidth * sceneScale : rect.width };
    });
    rows = makeHoverRows(entries);
    dirty = false;
    change(anchorHover(rows, active));
    if (pointer && !keyboard && !blocked()) change(pickPoint(pointer.x, pointer.y));
  }
  function pickPoint(x, y) {
    if (bounds && (x < bounds.left - 2 || x > bounds.right + 2 || y < bounds.top - 2 || y > bounds.bottom + 5)) return null;
    // Picking follows the stable target fan, not a moving DOM rectangle. The
    // newly active card contains the old boundary, so repeated events cannot
    // alternate cards as the fan opens. Clicking a revealed face selects it.
    return pickHover(spread?spreadHoverRows(rows,active):rows, x, y, active, { lift: (hoverLift() + 12) * sceneScale,selectedLift:selectionLift()*sceneScale });
  }
  function tick(time) {
    frame = 0;
    if (disposed || frozen || document.hidden) return;
    const start = window.performance.now();
    if (dirty) measure();
    const dt = previousTime === null ? 16.667 : Math.min(48, time - previousTime);
    previousTime = time;
    const allowed = !blocked();
    if (!allowed && active) change(null);
    const activeRow = active && rows[active.row];
    let pending = false;
    for (const entry of entries) {
      const index = activeRow?.items.findIndex(item => item.id === entry.id) ?? -1;
      // Both neighbours meet at nearly the same height before ownership changes.
      const distance = index >= 0 ? index - active.coordinate : Infinity;
      const weight = allowed && active && index >= 0 ? Math.exp(-distance * distance / .62) : 0;
      const isSelected=selected(entry.element);
      if(isSelected!==entry.isSelected){entry.isSelected=isSelected;entry.selectionMoving=true;}
      const targetY = isSelected ? -selectionLift() : -weight * hoverLift();
      // Open a reading gap around the pointer. Only the painted faces spread;
      // ownership remains on fixed resting strips, never animated rectangles.
      const targetX = spread && allowed && active && index >= 0 ? spreadOffset(activeRow,index,active.index) / sceneScale : 0;
      const immediate = reduced.matches || reducedMotion();
      const targetAngle = !isSelected && !immediate && allowed && active?.id === entry.id && !keyboard ? Math.max(-.9, Math.min(.9, (active.coordinate - index) * 1.5)) : 0;
      entry.x = immediate ? targetX : approach(entry.x, targetX, dt, 38);
      if(immediate){entry.y=targetY;entry.velocityY=0;entry.selectionMoving=false;}
      else if(entry.selectionMoving){const next=settleSelection(entry.y,entry.velocityY,targetY,dt);entry.y=next.position;entry.velocityY=next.velocity;}
      else entry.y=approach(entry.y,targetY,dt);
      entry.angle = immediate ? 0 : approach(entry.angle, targetAngle, dt, 40);
      if (Math.abs(entry.x - targetX) < .025) entry.x = targetX; else pending = true;
      if (Math.abs(entry.y - targetY) < .025&&Math.abs(entry.velocityY)<.08){entry.y=targetY;entry.velocityY=0;entry.selectionMoving=false;} else pending = true;
      if (Math.abs(entry.angle - targetAngle) < .004) entry.angle = targetAngle; else pending = true;
      if (entry.face) {
        entry.face.style.setProperty('transform', `translate3d(${entry.x.toFixed(3)}px,${entry.y.toFixed(3)}px,0) rotate(${entry.angle.toFixed(3)}deg)`, transformPriority);
        entry.face.style.transition = 'none';
      }
      entry.element.style.zIndex = active?.id === entry.id ? '100' : String(Math.round(-entry.y) + 1);
    }
    metrics.frames++;
    const duration = window.performance.now() - start;
    metrics.maxRenderMs = Math.max(metrics.maxRenderMs, duration);
    onFrame?.({ time, duration, active: active?.id ?? null, entries: entries.map(({ id, y, angle }) => ({ id, y, angle })) });
    if (pending) schedule(); else previousTime = null;
  }
  function move(event) {
    if (frozen || disposed || event.pointerType === 'touch' || document.hidden) return;
    metrics.pointerEvents++;
    pointer = { x: event.clientX, y: event.clientY };
    keyboard = false;
    if (blocked()) { change(null); return; }
    // Cache geometry between layout/scroll events; pointer events never read layout.
    if (dirty) { schedule(); return; }
    change(pickPoint(pointer.x, pointer.y));
  }
  function focus(event) {
    const entry = entries.find(item => item.element === event.target || item.element.contains(event.target));
    if (!entry || !event.target.matches(':focus-visible')) return;
    keyboard = true;
    const row = rows.findIndex(row => row.items.some(item => item.id === entry.id));
    change({ id: entry.id, row, index: rows[row].items.indexOf(entry), coordinate: rows[row].items.indexOf(entry) });
  }
  function clear() { pointer = null; keyboard = false; change(null); }
  function invalidate() { dirty = true; schedule(); }
  function visibility() {
    if (document.hidden) { if (frame) window.cancelAnimationFrame(frame); frame = 0; previousTime = null; clear(); }
    else invalidate();
  }
  const observer = new window.ResizeObserver(invalidate);
  observer.observe(root);
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerleave', clear);
  document.addEventListener('scroll', invalidate, { passive: true, capture: true });
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', clear);
  window.addEventListener('resize', invalidate);
  root.addEventListener('focusin', focus);
  reduced.addEventListener('change', invalidate);
  schedule();
  return {
    refresh: invalidate,
    pick(x, y) { if (dirty) measure(); return pickPoint(x, y); },
    element(id) { return entries.find(entry => entry.id === id)?.element ?? null; },
    restingRect(id) {
      if (dirty) measure();
      const entry = entries.find(entry => entry.id === id);
      return entry && { left: entry.left, top: entry.top - (selected(entry.element) ? selectionLift() * sceneScale : 0) };
    },
    freeze() { frozen = true; if (frame) window.cancelAnimationFrame(frame); frame = 0; previousTime = null; },
    resume() { frozen = false; pointer = null; keyboard = false; change(null); invalidate(); },
    clear,
    metrics: () => ({ ...metrics }),
    destroy() {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerleave', clear);
      document.removeEventListener('scroll', invalidate, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', clear);
      window.removeEventListener('resize', invalidate);
      root.removeEventListener('focusin', focus);
      reduced.removeEventListener('change', invalidate);
      delete root.dataset.handHover;
      delete root.dataset.hoveredCard;
    },
  };
}
