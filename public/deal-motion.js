import {tableScope} from './table-flow.js';
import {relativePosition} from './pixel-view.js';

export const DEAL_FLIGHT_MS = 320;
const dealing = game => game?.dealing === 'continuous' && ['dealing','closing'].includes(game.phase);

// Public draw progress is the only trigger. Repaints and declarations cannot
// restart a flight; loading/restoring a table never replays its draw history.
export class DealFlow {
  constructor(){this.scope=null;this.dealt=0;this.active=false;}
  update(game,active){
    const scope=tableScope(game),count=game?.dealt||0;
    const fresh=scope===this.scope&&count>this.dealt&&this.active;
    this.scope=scope;this.dealt=count;this.active=active&&dealing(game);
    return fresh&&this.active&&Number.isInteger(game.drawSeat)&&game.drawSeat>=0&&game.drawSeat<4?{key:scope+':'+count,seat:game.drawSeat}:null;
  }
}

export function createDealMotion({back,document:doc=document}){
  const flow=new DealFlow(),flights=new Set(),moves=new Map();
  let layer=null,scope=null;
  function clear(){
    for(const record of flights){record.animation.cancel();record.node.remove();}
    flights.clear();for(const animation of moves.values())animation.cancel();moves.clear();
    layer?.remove();layer=null;
  }
  function capture(game,active){
    const next=tableScope(game);
    if(!active||!dealing(game)||next!==scope){clear();scope=next;return new Map();}
    const before=new Map();
    for(const node of doc.querySelectorAll('.hand-slot'))before.set(node,{left:node.querySelector('.reflow').getBoundingClientRect().left});
    for(const animation of moves.values())animation.cancel();moves.clear();
    return before;
  }
  function update(game,{active,before=new Map()}={}){
    const cue=flow.update(game,active);
    if(!active||!dealing(game)){clear();return;}
    const board=doc.getElementById('cardTable'),hand=doc.getElementById('playerHand');
    const scale=Number(board?.dataset.sceneScale)||1;
    // Animate only a visual wrapper. Resting hit slots and the child's hover
    // transform remain independent of the reflow animation.
    for(const [node,old] of before){
      if(!node.isConnected)continue;
      const dx=(old.left-node.getBoundingClientRect().left)/scale;
      if(Math.abs(dx)<.5)continue;
      const animation=node.querySelector('.reflow').animate([{transform:`translateX(${dx}px)`},{transform:'translateX(0)'}],{duration:180,easing:'cubic-bezier(.2,.75,.25,1)'});
      moves.set(node,animation);animation.onfinish=()=>{if(moves.get(node)===animation)moves.delete(node);animation.cancel();};
    }
    if(!cue||!board)return;
    const stack=board.querySelector('.deck-stack');if(!stack)return;
    let target=cue.seat===game.viewer?hand:board.querySelector('.seat.'+relativePosition(game,cue.seat)+' .backs');
    if(!target)return;
    let end=target.getBoundingClientRect();
    if(cue.seat!==game.viewer&&(!end.width||!end.height)){
      target=board.querySelector('.seat.'+relativePosition(game,cue.seat)+' .seat-count');
      if(!target)return;end=target.getBoundingClientRect();
    }
    if(cue.seat===game.viewer){
      const node=[...hand.querySelectorAll('.hand-slot')].find(node=>node.dataset.arriving==='true');
      if(node){const box=node.getBoundingClientRect(),face=node.querySelector('.face');
        end={left:box.left,top:box.top,width:face.offsetWidth*scale,height:box.height};
      }
      // A card outside the mobile scroll window arrives at its visible edge.
      const visible=hand.getBoundingClientRect(),width=end.width;
      end={...end,left:Math.max(visible.left,Math.min(end.left,visible.right-width))};
    }
    const start=stack.getBoundingClientRect();
    const from={x:start.left+start.width/2,y:start.top+start.height/2},to={x:end.left+end.width/2,y:end.top+end.height/2};
    layer ||= Object.assign(doc.createElement('div'),{className:'deal-overlay'});
    if(!layer.isConnected){layer.setAttribute('aria-hidden','true');doc.body.append(layer);}
    // Separate bounded flights may overlap at the new 250 ms pace. Frozen
    // screen coordinates survive unrelated hand/declared-card layout updates.
    if(flights.size>=4){const first=flights.values().next().value;first.animation.cancel();first.node.remove();flights.delete(first);}
    const node=doc.createElement('span');node.className='deal-flight';node.dataset.flightKey=cue.key;
    node.dataset.from=JSON.stringify(from);node.dataset.to=JSON.stringify(to);
    node.innerHTML=back();Object.assign(node.style,{left:from.x+'px',top:from.y+'px',width:start.width+'px',height:start.height+'px'});layer.append(node);
    const dx=to.x-from.x,dy=to.y-from.y;
    const animation=node.animate([
      {transform:'translate(-50%,-50%) rotate(-4deg)',opacity:1},
      {transform:`translate(calc(-50% + ${dx*.6}px),calc(-50% + ${dy*.6-15}px)) rotate(2deg)`,opacity:1,offset:.55},
      {transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.7) rotate(4deg)`,opacity:0},
    ],{duration:DEAL_FLIGHT_MS,easing:'cubic-bezier(.2,.6,.3,1)',fill:'both'});
    const record={node,animation};flights.add(record);
    animation.onfinish=()=>{flights.delete(record);node.remove();animation.cancel();};
  }
  return {capture,update,clear};
}
