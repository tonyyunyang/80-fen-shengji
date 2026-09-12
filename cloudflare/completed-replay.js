import {makeDeck} from '../src/cards.js';
import {publicView} from '../src/game.js';
import {resolveTrick,scoreDeal,followError,classify} from '../src/rules.js';

const deck=makeDeck(), ids=cards=>cards.map(card=>card.id);
const check=(condition,message)=>{if(!condition)throw new Error('Invalid completed replay: '+message);};
const sameCards=(a,b)=>{const sorted=[...b].sort((x,y)=>x-y);return a.length===b.length&&[...a].sort((x,y)=>x-y).every((id,i)=>id===sorted[i]);};
const physical=id=>{check(Number.isInteger(id)&&!!deck[id],'card identity');return deck[id];};

// Called only by the terminal-result gate. Recover the original 25-card hands
// from private draw events, not a seed that could expose the next deal. The
// eight original kitty cards are taken together; their array order is immaterial.
export function completedReplay(state){
  const epoch=state.completedDealEpoch;
  const events=publicView(state,-1).events.filter(event=>event.deal===epoch);
  const start=events.find(event=>event.type==='deal_started');
  const draws=state.events.filter(event=>event.deal===epoch&&event.type==='draw').map(({seq,seat,card,dealt})=>({seq,seat,card:card.id,dealt}));
  const hands=[[],[],[],[]];
  check(draws.length===100&&new Set(draws.map(draw=>draw.card)).size===100,'100 unique dealt cards');
  draws.forEach((draw,index)=>{
    physical(draw.card);
    check(draw.dealt===index+1&&draw.seat===(start.first+index)%4,'draw order');
    hands[draw.seat].push(draw.card);
  });
  const dealt=new Set(hands.flat());
  const replay={format:'eighty-completed-deal',version:2,gameId:state.id,dealEpoch:epoch,
    ruleset:state.ruleset,rules:structuredClone(state.rules),dealer:state.dealer,trump:{...state.trump},
    levelsBefore:[...start.levels],levelsAfter:[...state.match.levels],
    deal:{first:start.first,draws,hands,kitty:ids(deck.filter(card=>!dealt.has(card.id)))},
    buried:ids(state.kitty),events};
  // Cheap completeness check on the settlement path. Full rules verification
  // belongs to operator-side replay/testing, not a second game on the Worker.
  check(replay.buried.length===8,'eight buried cards');
  hands.forEach((hand,seat)=>{
    const held=seat===state.dealer?[...hand,...replay.deal.kitty]:hand;
    const used=events.filter(event=>event.type==='play'&&event.seat===seat).flatMap(event=>ids(event.cards));
    if(seat===state.dealer)used.push(...replay.buried);
    check(sameCards(held,used),'complete hand history');
  });
  return replay;
}

// Operator-side replay of every hand, play and captured trick. This is private
// archive tooling, never an active-player observation or public asset.
export function replayTimeline(replay){
  check(replay?.format==='eighty-completed-deal'&&replay.version===2,'full replay unavailable (legacy public events only)');
  const {deal,dealer,trump,rules,events,buried}=replay;
  check(deal.hands.length===4&&deal.hands.every(hand=>hand.length===25)&&deal.kitty.length===8,'initial hands');
  const all=[...deal.hands.flat(),...deal.kitty];all.forEach(physical);
  check(new Set(all).size===108,'complete physical deck');
  const hands=structuredClone(deal.hands),captured=[[],[]],frames=[];
  let plays=[],attackPoints=0,leader=dealer,trickIndex=0,lastTrick=null;
  const frame=(stage,extra={})=>frames.push({stage,hands:structuredClone(hands),captured:structuredClone(captured),
    plays:structuredClone(plays),trump:{...trump},dealer,attackPoints,...extra});
  const remove=(seat,cardIds)=>{
    check(new Set(cardIds).size===cardIds.length&&cardIds.every(id=>hands[seat].includes(id)),'played/buried card belongs to hand');
    hands[seat]=hands[seat].filter(id=>!cardIds.includes(id));
  };
  frame('dealt');hands[dealer].push(...deal.kitty);frame('kitty');
  check(buried.length===8,'eight buried cards');remove(dealer,buried);frame('buried');
  for(const event of events){
    if(event.type==='trump_set')check(event.dealer===dealer&&event.trump.rank===trump.rank&&event.trump.suit===trump.suit,'trump');
    if(event.type==='play'){
      check(event.trick===trickIndex&&event.seat===(leader+plays.length)%4&&event.cards.length>0,'play order');
      const cardIds=ids(event.cards),cards=cardIds.map(physical);
      check(event.cards.every((card,i)=>card.rank===cards[i].rank&&card.suit===cards[i].suit),'physical card face');
      if(plays.length)check(!followError(hands[event.seat].map(physical),cards,classify(plays[0].cards.map(physical),trump),trump,rules),'legal follow');
      remove(event.seat,cardIds);plays.push({seat:event.seat,cards:cardIds});frame('play',{seq:event.seq,trick:trickIndex});
    }else if(event.type==='trick'){
      check(plays.length===4&&event.index===trickIndex,'complete trick');
      const result=resolveTrick(plays.map(play=>({...play,cards:play.cards.map(physical)})),trump);
      check(result.winner===event.winner&&result.points===event.points,'trick winner and score');
      captured[result.winner%2].push(...plays.flatMap(play=>play.cards));
      if(result.winner%2!==dealer%2)attackPoints+=result.points;
      lastTrick={winner:result.winner,count:plays[0].cards.length};leader=result.winner;plays=[];trickIndex++;
      frame('trick',{seq:event.seq,trick:event.index,winner:result.winner,points:result.points});
    }else if(event.type==='round_scored'){
      check(lastTrick&&hands.every(hand=>hand.length===0)&&plays.length===0,'finished deal');
      const score=scoreDeal(attackPoints,buried.map(physical),lastTrick.winner%2!==dealer%2,lastTrick.count);
      check(sameCards(ids(event.kitty),buried)&&Object.keys(score).every(key=>score[key]===event.score[key]),'final settlement');
      frame('scored',{seq:event.seq,score,levels:[...replay.levelsAfter]});
    }
  }
  check(frames.at(-1)?.stage==='scored','terminal result');
  return frames;
}
