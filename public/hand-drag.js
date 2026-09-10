// A gesture owns one physical card. The caller validates single-card drops.
export function createHandDrag(root, { hover, allowed, toggle, drop, changed, reducedMotion = () => false }) {
  let gesture = null, ghost = null;
  const returning = new Set();
  const target = () => document.getElementById('dropTarget');
  const over = (x,y) => { const box=target()?.getBoundingClientRect();return box&&x>=box.left&&x<=box.right&&y>=box.top&&y<=box.bottom; };
  function release() {
    const current=gesture, held=ghost;gesture=null;ghost=null;
    if(current&&root.hasPointerCapture?.(current.pointerId))root.releasePointerCapture(current.pointerId);
    document.body.classList.remove('dragging-card');target()?.classList.remove('over');
    hover.resume();changed?.();return {current,held};
  }
  function settle(current,held,played=false,immediate=false){
    if(!current)return;
    const clean=()=>{held?.remove();current.node.classList.remove('is-drag-source');returning.delete(clean);};
    if(!held||immediate||reducedMotion()||!current.node.isConnected){clean();return;}
    returning.add(clean);
    const slot=current.node.getBoundingClientRect();
    const selected=current.node.getAttribute('aria-pressed')==='true';
    const scale=root.clientWidth?root.getBoundingClientRect().width/root.clientWidth:1;
    const x=slot.left-current.rect.left,y=slot.top-(selected?38*scale:0)-current.rect.top;
    const from=held.style.transform||'translate3d(0,0,0)';
    const frames=played?[{transform:from,opacity:1},{transform:from+' scale(.94)',opacity:0}]:[
      {transform:from},
      {transform:`translate3d(${current.dx*.35+x*.65}px,${current.dy*.35+y*.65-12}px,0) rotate(-2deg)`,offset:.65},
      {transform:`translate3d(${x}px,${y}px,0) rotate(0deg)`},
    ];
    held.dataset.returning=String(!played);
    held.animate(frames,{duration:played?130:300,easing:'cubic-bezier(.2,.75,.25,1)',fill:'forwards'}).finished.then(clean,clean);
  }
  function cancel(immediate=false){const {current,held}=release();settle(current,held,false,immediate);}
  function down(event){
    if(event.button!==0||gesture||!allowed())return;
    const hit=hover.pick(event.clientX,event.clientY),node=hit&&hover.element(hit.id);
    if(!node||node.disabled)return;
    for(const clean of [...returning])clean();
    if(event.pointerType!=='touch')event.preventDefault();
    const face=node.querySelector('.face');
    gesture={pointerId:event.pointerId,id:Number(node.dataset.card),node,face,rect:face.getBoundingClientRect(),x:event.clientX,y:event.clientY,dx:0,dy:0,dragging:false,shift:event.shiftKey};
    hover.freeze();root.setPointerCapture(event.pointerId);
  }
  function move(event){
    if(!gesture||event.pointerId!==gesture.pointerId)return;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;gesture.dx=dx;gesture.dy=dy;
    if(!gesture.dragging&&Math.hypot(dx,dy)>7){
      gesture.dragging=true;gesture.node.classList.add('is-drag-source');document.body.classList.add('dragging-card');
      ghost=document.createElement('div');ghost.className='drag-ghost';ghost.dataset.cardId=String(gesture.id);ghost.setAttribute('aria-hidden','true');
      Object.assign(ghost.style,{left:gesture.rect.left+'px',top:gesture.rect.top+'px',width:gesture.rect.width+'px',height:gesture.rect.height+'px'});
      ghost.append(gesture.face.cloneNode(true));document.body.append(ghost);
    }
    if(ghost){ghost.style.transform=`translate3d(${dx}px,${dy}px,0) rotate(${Math.max(-6,Math.min(6,dx*.02))}deg)`;target()?.classList.toggle('over',!!over(event.clientX,event.clientY));}
  }
  function up(event){
    if(!gesture||event.pointerId!==gesture.pointerId)return;
    const validTarget=gesture.dragging&&over(event.clientX,event.clientY),{current,held}=release();
    let played=false;
    if(allowed()){
      if(!current.dragging)toggle(current.id,current.shift);
      else if(validTarget)played=drop(current.id)===true;
    }
    settle(current,held,played);
  }
  const lost=()=>{if(gesture)cancel();};
  const visibility=()=>{if(document.hidden)cancel(true);};
  root.addEventListener('pointerdown',down);root.addEventListener('pointermove',move);root.addEventListener('pointerup',up);
  root.addEventListener('pointercancel',lost);root.addEventListener('lostpointercapture',lost);window.addEventListener('blur',lost);document.addEventListener('visibilitychange',visibility);
  return {get active(){return !!gesture;},cancel,destroy(){cancel(true);for(const clean of [...returning])clean();root.removeEventListener('pointerdown',down);root.removeEventListener('pointermove',move);root.removeEventListener('pointerup',up);root.removeEventListener('pointercancel',lost);root.removeEventListener('lostpointercapture',lost);window.removeEventListener('blur',lost);document.removeEventListener('visibilitychange',visibility);}};
}
