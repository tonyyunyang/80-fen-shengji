import { createHash } from 'node:crypto';
import { makeDeck, effectiveSuit, order, points, randomSource, shuffle, sortedHand } from './cards.js';
import { classify, components, groups, enumerateLegalFollows, followError, resolveTrick, scoreDeal, adjudicateThrow } from './rules.js';
import { buildNotebook, publicPlays } from './notebook.js';
import { practiceRolloutAction } from './peilian.js';

const deck=makeDeck(),cache=new Map();
const signature=cards=>cards.map(card=>card.id).sort((a,b)=>a-b).join(',');

export function candidateLeads(hand,trump){
  const result=hand.map(card=>[card]),seen=new Set(result.map(signature));
  const add=cards=>{const key=signature(cards);if(!seen.has(key)){seen.add(key);result.push(cards);}};
  for(const group of groups(hand))if(group.length===2)add(group);
  for(const suit of ['T','S','H','D','C']){
    const suited=hand.filter(card=>effectiveSuit(card,trump)===suit);if(suited.length>1)add(suited);
    for(const part of components(suited,trump))if(part.type==='tractor'){
      for(let start=0;start<part.cards.length-2;start+=2)for(let end=start+4;end<=part.cards.length;end+=2)add(part.cards.slice(start,end));
    }
  }
  return result;
}

// Restore each historical following hand backwards. Voids alone are not enough:
// a sampled hand must also respect public evidence of missing pairs/tractors.
export function consistentFollows(view,hands){
  const remaining=hands.map(hand=>[...hand]),history=publicPlays(view);
  for(let i=history.length-1;i>=0;i--){
    const play=history[i];remaining[play.seat].push(...play.cards);
    if(i%4&&followError(remaining[play.seat],play.cards,classify(history[i-i%4].cards,view.trump),view.trump,view.rules))return false;
  }
  return true;
}

export function sampleEndgamePositions(view,{samples=32,attempts=640}={}){
  const history=publicPlays(view),notebook=buildNotebook(view),dealer=view.declSeat;
  const knownKitty=view.buriedKnown||[],known=new Set([...history.flatMap(play=>play.cards),...view.hand,...knownKitty].map(card=>card.id));
  const pool=deck.filter(card=>!known.has(card.id));
  const capacity=Array.from({length:5},(_,seat)=>seat===4?(knownKitty.length?0:8):seat===view.seat?0:view.handSizes[seat]);
  if(pool.length!==capacity.reduce((a,b)=>a+b,0))return [];
  const voids=Array.from({length:4},(_,seat)=>new Set(notebook.provenVoids.filter(row=>row.seat===seat).map(row=>row.suit)));
  const declared=new Map();
  for(const declaration of view.declarations||[])for(const card of declaration.cards||[])if(!known.has(card.id))declared.set(card.id,declaration.seat===dealer&&!knownKitty.length?[dealer,4]:[declaration.seat]);
  const destinations=new Map(pool.map(card=>[card.id,capacity.map((count,seat)=>count>0&&(!declared.has(card.id)||declared.get(card.id).includes(seat))&&(seat===4||!voids[seat].has(effectiveSuit(card,view.trump)))?seat:-1).filter(seat=>seat>=0)]));
  if([...destinations.values()].some(seats=>!seats.length))return [];
  // The seed is a function of permitted information, never the shuffle seed.
  const basis=JSON.stringify([view.seat,view.hand.map(c=>c.id),view.handSizes,view.trump,history.map(p=>[p.seat,p.cards.map(c=>c.id)]),knownKitty.map(c=>c.id),[...declared],view.rules]);
  const random=randomSource(createHash('sha256').update(basis).digest().readUInt32LE());
  const result=[],seen=new Set();
  for(let attempt=0;attempt<attempts&&result.length<samples;attempt++){
    const remaining=[...capacity],assigned=Array.from({length:5},()=>[]);
    const cards=shuffle(pool,random).sort((a,b)=>destinations.get(a.id).length-destinations.get(b.id).length);
    let valid=true;
    for(const card of cards){
      const choices=destinations.get(card.id).filter(seat=>remaining[seat]>0),total=choices.reduce((sum,seat)=>sum+remaining[seat],0);
      if(!total){valid=false;break;}
      let draw=random()*total,chosen=choices.at(-1);
      for(const seat of choices){draw-=remaining[seat];if(draw<0){chosen=seat;break;}}
      assigned[chosen].push(card);remaining[chosen]--;
    }
    if(!valid)continue;
    assigned[view.seat]=[...view.hand];
    if(!consistentFollows(view,assigned.slice(0,4)))continue;
    const key=assigned.map(signature).join('|');if(seen.has(key))continue;seen.add(key);
    result.push({hands:assigned.slice(0,4),kitty:knownKitty.length?[...knownKitty]:assigned[4],plays:structuredClone(view.plays),history:structuredClone(history),trump:view.trump,rules:view.rules,dealer,leader:view.plays.length?view.plays[0].seat:view.seat,attackPoints:view.attackPoints||0,
      public:{levels:view.levels,played:view.played,firstTaker:view.firstTaker,curDecl:view.curDecl,declarations:view.declarations,round:view.round}});
  }
  return result;
}

const controlValue=(hand,trump)=>hand.reduce((sum,card)=>sum+(effectiveSuit(card,trump)==='T'?2+order(card,trump)*.6:Math.max(0,order(card,trump)-7)*.55),0)+groups(hand).filter(group=>group.length===2).length*3;
function legalPlays(position,seat){
  const hand=position.hands[seat];
  if(!position.plays.length)return candidateLeads(hand,position.trump);
  const ids=enumerateLegalFollows(hand,classify(position.plays[0].cards,position.trump),position.trump,position.rules,256,1000);
  if(!ids?.length)throw new Error('Endgame continuation lacks a complete legal menu');
  const byId=new Map(hand.map(card=>[card.id,card]));return ids.map(move=>move.map(id=>byId.get(id)));
}
function rolloutChoice(position,seat){
  const hand=position.hands[seat],trump=position.trump,current=position.plays,options=legalPlays(position,seat);
  let best=null,bestValue=-Infinity;
  const winner=current.length?resolveTrick(current,trump).winner:null,partner=(seat+2)%4;
  const opponentsAfter=current.length?Array.from({length:3-current.length},(_,i)=>(seat+1+i)%4).filter(player=>player%2!==seat%2).length:2;
  for(const cards of options){
    const used=new Set(cards.map(card=>card.id)),rest=hand.filter(card=>!used.has(card.id));
    let value=controlValue(rest,trump);
    if(current.length){
      const outcome=resolveTrick([...current,{seat,cards}],trump),ourWin=outcome.winner%2===seat%2;
      value+=(ourWin?1:-1)*outcome.points*(opponentsAfter?.7:1.5)+(ourWin?5:0);
      if(winner===partner&&outcome.winner===seat&&opponentsAfter===0)value-=4;
      if(rest.length===0&&ourWin)value+=35;
    }else{
      const shape=classify(cards,trump),strength=shape.top;
      value+=Math.max(0,strength-8)*1.6+cards.length*2;
      if(shape.suit!=='T')value+=Math.max(0,strength-9)*1.5;
    }
    if(value>bestValue){bestValue=value;best=cards;}
  }
  return best;
}
function applyPlay(position,seat,cards){
  if(!position.plays.length)cards=adjudicateThrow(position.hands,seat,cards,position.trump).cards;
  else if(followError(position.hands[seat],cards,classify(position.plays[0].cards,position.trump),position.trump,position.rules))throw new Error('Illegal sampled continuation');
  const used=new Set(cards.map(card=>card.id));position.hands[seat]=position.hands[seat].filter(card=>!used.has(card.id));position.plays.push({seat,cards});position.history.push({seat,cards});
  if(position.plays.length!==4)return null;
  const result=resolveTrick(position.plays,position.trump),size=position.plays[0].cards.length,attack=result.winner%2!==position.dealer%2;
  if(attack)position.attackPoints+=result.points;
  position.leader=result.winner;position.plays=[];
  return position.hands.every(hand=>hand.length===0)?scoreDeal(position.attackPoints,position.kitty,attack,size):null;
}
export function rolloutEndgame(position,seat,first){
  const state=structuredClone(position);let score=applyPlay(state,seat,first),steps=0;
  while(!score&&steps++<position.hands.reduce((sum,hand)=>sum+hand.length,0)+4){
    const actor=(state.leader+state.plays.length)%4;
    const view={...state.public,rules:state.rules,seat:actor,myTeam:actor%2,hand:sortedHand(state.hands[actor],state.trump),handSizes:state.hands.map(hand=>hand.length),phase:state.plays.length?'follow':'lead',trump:state.trump,trumpRank:state.trump.rank,dealer:state.dealer,declSeat:state.dealer,dealerKnown:true,history:state.history,plays:state.plays,buriedKnown:actor===state.dealer?state.kitty:[],attackPoints:state.attackPoints,gates:state.rules.gates,dealt:100,closing:false,options:null,kittySize:8};
    const action=practiceRolloutAction(view),cards=action?action.cardIds.map(id=>state.hands[actor].find(card=>card.id===id)):rolloutChoice(state,actor);
    if(cards.some(card=>!card))throw new Error('A continuation selected cards outside its own hand');
    score=applyPlay(state,actor,cards);
  }
  if(!score)throw new Error('Endgame continuation did not complete');
  return score;
}

export function buildEndgameEstimates(view,legalMoves=null,{maxHand=5,samples:sampleCount=32}={}){
  if(!view.trump||!['lead','follow'].includes(view.phase)||Math.max(...view.handSizes)>maxHand||view.hand.length<2)return null;
  const key=JSON.stringify([maxHand,sampleCount,view.seat,view.phase,view.declSeat,view.levels,view.played,view.round,view.firstTaker,view.hand.map(c=>c.id),view.handSizes,view.trump,publicPlays(view).map(p=>[p.seat,p.cards.map(c=>c.id)]),(view.buriedKnown||[]).map(c=>c.id),(view.declarations||[]).map(d=>[d.seat,(d.cards||[]).map(c=>c.id)]),view.attackPoints,view.rules,legalMoves]);
  if(cache.has(key))return structuredClone(cache.get(key));
  const byId=new Map(view.hand.map(card=>[card.id,card]));
  let options=view.phase==='lead'?candidateLeads(view.hand,view.trump):
    (legalMoves||enumerateLegalFollows(view.hand,classify(view.plays[0].cards,view.trump),view.trump,view.rules,256,1000))?.map(ids=>ids.map(id=>byId.get(id)))||[];
  if(options.length<2)return null;
  const totalOptions=options.length;
  if(options.length>24){
    // Keep both score and control extremes. Only estimate coverage is bounded;
    // the model's legal action set is never shortened.
    options=[...options].sort((a,b)=>points(a)-points(b)||controlValue(a,view.trump)-controlValue(b,view.trump));
    options=options.filter((_,index)=>index%Math.ceil(totalOptions/24)===0);
  }
  const samples=sampleEndgamePositions(view,{samples:sampleCount}),attack=view.seat%2!==view.declSeat%2;
  if(!samples.length)return null;
  const candidates=options.map(cards=>{
    const scores=samples.map(sample=>rolloutEndgame(sample,view.seat,cards)),id=legalMoves?.findIndex(ids=>signature(cards)===ids.slice().sort((a,b)=>a-b).join(','));
    return {cardIds:cards.map(c=>c.id),...(id>=0?{moveId:id}:{}),sampledTeamWins:scores.filter(score=>score.attackersWin===attack).length,meanAttackerPoints:Math.round(scores.reduce((sum,score)=>sum+score.total,0)/scores.length*10)/10};
  });
  const result={basis:'Uncertain endgame estimates, not actual hidden hands or calibrated probabilities. Same constrained samples for each candidate. Each simulated seat uses a fast practice rollout with only its own hypothetical observation. Optimize final team outcome, not agreement with that policy.',samples:samples.length,coverage:{evaluated:options.length,totalCandidates:totalOptions,leadMenuComplete:false,fullSuitThrowsIncluded:view.phase==='lead'},candidates};
  cache.set(key,result);if(cache.size>24)cache.delete(cache.keys().next().value);
  return structuredClone(result);
}
