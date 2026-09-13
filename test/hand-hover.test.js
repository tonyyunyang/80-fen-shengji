import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHoverRows, pickHover, approach,settleSelection } from '../public/hand-hover.js';

function hand(count, columns = count) {
  return Array.from({ length: count }, (_, id) => ({ id, left: 40 + id % columns * 34,
    top: 300 + Math.floor(id / columns) * 100, width: 100, height: 150 }));
}

test('a slow sweep visits every exposed card exactly once in both directions', () => {
  for (const count of [25, 33]) {
    const rows = makeHoverRows(hand(count));
    for (const direction of [1, -1]) {
      const visited = [], xs = [];
      for (let x = rows[0].left; x <= rows[0].right; x += 1) xs.push(x);
      if (direction < 0) xs.reverse();
      let previous = null;
      for (const x of xs) {
        const next = pickHover(rows, x, 340, previous);
        if (next && next.id !== visited.at(-1)) visited.push(next.id);
        previous = next;
      }
      assert.deepEqual(visited, direction > 0 ? Array.from({ length: count }, (_, i) => i) : Array.from({ length: count }, (_, i) => count - 1 - i));
    }
  }
});

test('a raised card cannot retain ownership across its neighbour or a fast sweep', () => {
  const rows = makeHoverRows(hand(25));
  const first = pickHover(rows, 45, 330);
  assert.equal(first.id, 0);
  assert.equal(pickHover(rows, 79, 330, first).id, 1);
  assert.equal(pickHover(rows, 40 + 23 * 34 + 8, 330, first).id, 23);
  assert.equal(pickHover(rows, 1, 330, first), null);
});

test('small boundary jitter does not alternate the active card', () => {
  const rows = makeHoverRows(hand(3));
  let previous = pickHover(rows, 72, 330);
  for (const x of [73.9, 74.2, 73.8, 74.6, 74.1]) {
    previous = pickHover(rows, x, 330, previous);
    assert.equal(previous.id, 0);
  }
  assert.equal(pickHover(rows, 76, 330, previous).id, 1);
});

test('two-row hands retain the back row above its baseline and choose the front row at its baseline', () => {
  const rows = makeHoverRows(hand(33, 17));
  assert.equal(rows.length, 2);
  const back = pickHover(rows, 52, 310);
  assert.equal(back.id, 0);
  assert.equal(pickHover(rows, 52, 275, back).id, 0);
  assert.equal(pickHover(rows, 52, 410, back).id, 17);
  assert.equal(pickHover(rows, 52, 250, back), null);
});

test('frame-rate independent easing is continuous, monotonic and never overshoots', () => {
  for (const hz of [60, 120, 144]) {
    let y = 0;
    for (let i = 0; i < Math.ceil(hz / 4); i++) {
      const next = approach(y, -34, 1000 / hz);
      assert.ok(next <= y && next >= -34);
      y = next;
    }
    assert.ok(Math.abs(y + 34) < .02);
  }
  assert.ok(Math.abs(approach(0, -34, 100) - approach(approach(0, -34, 50), -34, 50)) < 1e-10);
  assert.equal(approach(-12, -34, 0), -12);
  assert.ok(approach(-12, 0, 16) > -12);
});

test('the expanded reading fan has stable ownership in both sweep directions', async () => {
  const {spreadHoverRows}=await import('../public/hand-hover.js');
  for(const count of [25,33]){
    const rows=makeHoverRows(Array.from({length:count},(_,index)=>({id:index,left:100+index*30,top:200,width:index===count-1?108:30,height:162,faceWidth:108})));
    for(const direction of [1,-1]){
      const xs=Array.from({length:count*30+220},(_,i)=>i+10);if(direction<0)xs.reverse();
      let active=null;const visited=[];
      for(const x of xs){
        active=pickHover(spreadHoverRows(rows,active),x,250,active);
        if(active&&active.id!==visited.at(-1))visited.push(active.id);
        for(let i=0;i<4;i++){
          const again=pickHover(spreadHoverRows(rows,active),x,250,active);
          assert.equal(again?.id,active?.id,'opening the fan cannot steal the pointer');active=again;
        }
      }
      assert.deepEqual(visited,direction===1?Array.from({length:count},(_,i)=>i):Array.from({length:count},(_,i)=>count-1-i));
    }
  }
});

test('a retained hover identity is re-anchored after new cards reorder the hand',async()=>{
 const {anchorHover,spreadHoverRows}=await import('../public/hand-hover.js');
 const before=makeHoverRows(hand(25)),active=pickHover(before,40+8*34+5,330);
 const reordered=makeHoverRows(hand(33).map((card,index)=>({...card,id:index<3?100+index:index-3,faceWidth:100})));
 const moved=anchorHover(reordered,active);
 assert.equal(moved.id,active.id);assert.equal(moved.index,active.index+3);
 assert.equal(moved.coordinate-moved.index,active.coordinate-active.index);
 const removed=makeHoverRows(hand(3));assert.equal(anchorHover(removed,active),null);
 const row=spreadHoverRows(reordered,moved)[0];assert.equal(row.items[moved.index].id,active.id);
});

test('raised selected cards are directly clickable from above without stealing a resting row',()=>{
  const rows=makeHoverRows(hand(5).map(c=>({...c,isSelected:c.id===2})));
  assert.equal(pickHover(rows,120,270,null,{selectedLift:48}).id,2);
  assert.equal(pickHover(rows,120,249,null,{selectedLift:48}),null);
  assert.equal(pickHover(rows,78,270,null,{selectedLift:48}),null);
  assert.equal(pickHover(rows,150,330,null,{selectedLift:48}).id,3);
});
test('selection motion settles equally across frame rates and reverses from its current pose',()=>{
  const results=[];
  for(const hz of [60,120,144]){
    let value={position:-34,velocity:0};
    for(let frame=0;frame<hz/2;frame++)value=settleSelection(value.position,value.velocity,-48,1000/hz);
    assert.ok(Math.abs(value.position+48)<.001);results.push(value.position);
  }
  assert.ok(Math.max(...results)-Math.min(...results)<1e-10);
  const up=settleSelection(-15,-200,-48,16),reversed=settleSelection(up.position,up.velocity,0,0);
  assert.deepEqual(reversed,up);assert.ok(Number.isFinite(settleSelection(up.position,up.velocity,0,16).position));
});
