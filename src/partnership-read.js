import {effectiveSuit,order,points,cardLabel} from './cards.js';
import {classify,components,resolveTrick} from './rules.js';
import {publicPlays} from './notebook.js';
import {possibleHoldings,matchingPackets} from './cooperation-context.js';

// Probability under an explicitly uniform per-seat reference allocation.
// This is a reading aid, not a calibrated posterior or proof about a real hand.
export function packetReferenceChance(total,draws,required=0,excluded=0){
  if(![total,draws,required,excluded].every(Number.isInteger)||Math.min(total,draws,required,excluded)<0||draws>total||required+excluded>total||required>draws||draws>total-excluded)return 0;
  let chance=1;
  for(let i=0;i<required;i++)chance*=(draws-i)/(total-i);
  for(let i=0;i<draws-required;i++)chance*=(total-required-excluded-i)/(total-required-i);
  return chance;
}
const round=n=>Math.round(Math.max(0,Math.min(1,n))*10000)/10000;
const partnerOf=seat=>(seat+2)%4;
const relation=(seat,you)=>seat===you?'you':seat===partnerOf(you)?'partner':'opponent';

function conserved(view){
  const cards=[...publicPlays(view).flatMap(p=>p.cards),...view.hand,...(view.buriedKnown||[])];
  const ids=new Set(cards.map(c=>c.id));
  return cards.length===ids.size&&view.handSizes[view.seat]===view.hand.length&&
    108-ids.size===view.handSizes.reduce((sum,size,seat)=>sum+(seat===view.seat?0:size),0)+(view.buriedKnown?.length?0:8);
}

function counterRead(view,notebook,seat,lead,winning){
  const holding=possibleHoldings(view,notebook,seat),{pool,fixed,size,consistent}=holding;
  const fixedIds=new Set(fixed.map(c=>c.id)),unknown=pool.filter(c=>!fixedIds.has(c.id));
  const draws=size-fixed.length,N=unknown.length,led=lead.suit;
  const inLed=c=>effectiveSuit(c,view.trump)===led;
  const fixedLed=fixed.filter(inLed).length,ledCount=unknown.filter(inLed).length;
  const voidChance=fixedLed?0:packetReferenceChance(N,draws,0,ledCount);
  const result={seat,relation:relation(seat,view.seat),provenVoid:holding.voids.has(led),
    minimumLedCards:Math.max(fixedLed,size-pool.filter(c=>!inLed(c)).length,0),referenceMustFollow:round(1-voidChance),
    referenceCounterRisk:null,referenceRuffRisk:null};
  if(!consistent||!conserved(view))return {...result,referenceMustFollow:null,status:'insufficient_consistent_public_history'};
  if(!['single','pair','tractor'].includes(lead.type))return {...result,status:'complex_structure_not_estimated'};
  const counterChance=(suit,ruff)=>{
    if(ruff&&fixedLed)return {risk:0,complete:true};
    const beats=c=>winning.suit==='T'?order(c,view.trump)>winning.top:ruff||order(c,view.trump)>winning.top;
    const cards=pool.filter(c=>effectiveSuit(c,view.trump)===suit);
    if(lead.type==='single'){
      const high=unknown.filter(c=>effectiveSuit(c,view.trump)===suit&&beats(c)).length;
      const fixedHigh=fixed.some(c=>effectiveSuit(c,view.trump)===suit&&beats(c));
      const avoidLed=ruff?ledCount:0;
      const eligible=packetReferenceChance(N,draws,0,avoidLed);
      return {risk:fixedHigh?eligible:eligible-packetReferenceChance(N,draws,0,avoidLed+high),complete:true};
    }
    const {packets,complete}=matchingPackets(cards,lead,view.trump);
    let bound=0;
    for(const packet of packets){
      if(!beats(packet.reduce((a,b)=>order(a,view.trump)>order(b,view.trump)?a:b)))continue;
      const needed=packet.filter(c=>!fixedIds.has(c.id)).length;
      bound+=packetReferenceChance(N,draws,needed,ruff?ledCount:0);
    }
    return {risk:Math.min(1,bound),complete};
  };
  const follow=winning.suit==='T'&&led!=='T'?{risk:0,complete:true}:counterChance(led,false);
  const ruff=led==='T'?{risk:0,complete:true}:counterChance('T',true);
  if(!follow.complete||!ruff.complete)return {...result,status:'counter_enumeration_incomplete'};
  return {...result,status:'uniform_reference_only',referenceCounterRisk:round(follow.risk+ruff.risk),referenceRuffRisk:round(ruff.risk)};
}

export function buildPartnershipRead(view,moves,compact){
  if(!view.trump||!['lead','follow'].includes(view.phase))return null;
  const notebook=compact.notebook,trump=view.trump,partner=partnerOf(view.seat),history=publicPlays(view);
  const playedBy=new Map(history.flatMap(p=>p.cards.map(c=>[c.id,p.seat]))),owned=new Set(view.hand.map(c=>c.id)),buried=new Set((view.buriedKnown||[]).map(c=>c.id));
  const dealer=compact.partnership.dealer;
  const declarations=(view.declarations||[]).map((bid,index)=>({order:index+1,seat:bid.seat,relation:relation(bid.seat,view.seat),
    calledSuit:bid.suit,strength:bid.strength,superseded:index<view.declarations.length-1,
    shown:(bid.cards||[]).map(c=>({card:[c.id,c.suit,c.rank],face:cardLabel(c),location:playedBy.has(c.id)?'played':owned.has(c.id)?'your_hand':buried.has(c.id)?'your_burial':bid.seat===dealer?'dealer_hand_or_kitty':'revealing_players_hand',
      ...(playedBy.has(c.id)?{playedBy:playedBy.get(c.id)}:{})}))}));
  const ownSuits=notebook.suits.map(s=>{
    const hand=view.hand.filter(c=>effectiveSuit(c,trump)===s.suit),top=hand.reduce((a,c)=>!a||order(c,trump)>order(a,trump)?c:a,null);
    const outside=s.unlocatedFaces;
    return {suit:s.suit,held:hand.length,points:points(hand),shortPointHolding:hand.length>0&&hand.length<=4&&points(hand)>0,
      structures:components(hand,trump).filter(p=>p.type!=='single').map(p=>({type:p.type,cardIds:p.cards.map(c=>c.id),top:p.top})),
      topFace:top?cardLabel(top):null,higherUnlocated:top?outside.filter(([s,r])=>order({suit:s,rank:r},trump)>order(top,trump)):[],
      publicPlayBySeat:Array.from({length:4},(_,seat)=>({seat,ledTimes:history.filter((p,i)=>i%4===0&&p.seat===seat&&effectiveSuit(p.cards[0],trump)===s.suit).length,
        cardsPlayed:history.filter(p=>p.seat===seat).flatMap(p=>p.cards).filter(c=>effectiveSuit(c,trump)===s.suit).length,
        pointsPlayed:points(history.filter(p=>p.seat===seat).flatMap(p=>p.cards).filter(c=>effectiveSuit(c,trump)===s.suit)),
        provenVoid:notebook.provenVoids.some(v=>v.seat===seat&&v.suit===s.suit)}))};
  });
  const result={version:1,declarations,ownSuits,
    evidencePolicy:'Accepted declarations remain public evidence after an overcall. Exact exposed cards constrain holdings; a called suit is only a possible preference, never proof of length. Passes, private eligibility and request timing are not signals.',
    referenceModel:'Uniform allocation within each remaining seat\'s publicly allowed card pool, conditioned on its fixed revealed cards and hand size. Single-card risks are exact only under that reference; pair/tractor risks use a union bound. This ignores strategic burial/selection bias and joint allocation weights: it is not a calibrated probability, sampled real hand, or secured-trick proof.',
    lowRiskThreshold:.04};
  const readsFor=(lead,winning,seats)=>seats.map(seat=>counterRead(view,notebook,seat,lead,winning));
  if(!view.plays.length){
    result.leadOpportunities=ownSuits.filter(s=>s.held&&s.suit!=='T').map(s=>{
      const hand=view.hand.filter(c=>effectiveSuit(c,trump)===s.suit),best=hand.reduce((a,c)=>order(c,trump)>order(a,trump)?c:a),shape=classify([best],trump);
      const counters=readsFor(shape,shape,compact.partnership.opponents),risk=counters.every(r=>r.referenceCounterRisk!==null)?Math.min(1,counters.reduce((sum,r)=>sum+r.referenceCounterRisk,0)):null;
      const partnerVoid=notebook.provenVoids.some(v=>v.seat===partner&&v.suit===s.suit);
      return {suit:s.suit,cardId:best.id,face:cardLabel(best),counters,partnerProvenVoid:partnerVoid,
        canOfferPartnerDiscardWindow:partnerVoid&&risk!==null&&risk<=result.lowRiskThreshold,
        checkPairsBeforeLeadingIntoPartnerVoid:partnerVoid&&s.structures.some(p=>p.type==='pair')};
    });
    return result;
  }
  const winner=resolveTrick(view.plays,trump).winner,lead=classify(view.plays[0].cards,trump),winning=classify(view.plays.find(p=>p.seat===winner).cards,trump);
  const remaining=compact.partnership.trick.afterYou.filter(p=>p.relation==='opponent').map(p=>p.seat),counters=readsFor(lead,winning,remaining);
  const risk=counters.every(r=>r.referenceCounterRisk!==null)?Math.min(1,counters.reduce((sum,r)=>sum+r.referenceCounterRisk,0)):null;
  const proven=compact.cooperation?.trick.partnerControl==='secured';
  const likely=winner===partner&&risk!==null&&risk<=result.lowRiskThreshold;
  result.trick={winningSeat:winner,partnerWinning:winner===partner,counters,referenceCounterRisk:risk,
    partnerWindow:winner!==partner?'not_partner':proven?'proven':likely?'low_reference_risk':'uncertain',
    avoidBlindFeed:!proven&&!likely,finalTrick:view.hand.length===lead.cards.length};
  const feeds=(compact.expertFacts?.moves||[]).filter(m=>m.keepsPartnerWinning&&m.pointCards>0);
  result.pointFeedOptions=feeds.map(m=>({move_id:m.move_id,points:m.pointCards,highTrumpsUsed:m.highTrumpCount,controlsUsed:m.controlsUsed,pairsBroken:m.pairsBroken,tractorDamage:m.tractorDamage}));
  if((proven||likely)&&feeds.length){
    // Cash points before protecting an expendable weak pair. Controls and
    // special trumps still have a separate cost; the model sees every tradeoff.
    const key=m=>[m.highTrumpCount,m.controlCost,-m.pointCards,m.pairsBroken,Math.max(0,m.tractorDamage),m.orderCost];
    const compare=(a,b)=>{const x=key(a),y=key(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;};
    const best=[...feeds].sort(compare)[0];result.preferredPointFeeds=feeds.filter(m=>compare(m,best)===0).map(m=>m.move_id);
  }else result.preferredPointFeeds=[];
  return result;
}

export const PARTNERSHIP_READ_PROMPT={
  zh:'partnershipRead补充配合读牌。declarations保留每次成功亮主与反主的先后、单双张和已亮牌后续去向；被反掉也不能忘，未亮/没反不能当作缺牌证明。ownSuits说明自己的短门分牌、长套和公开出牌记录。对手仍须跟同花色且大不过搭档时，要主动上分/跑分，不要等最后一家才肯垫分，也不要为了保弱对子错失窗口。partnerWindow=low_reference_risk仅表示均匀分牌参照下风险较低，绝非已知对手手牌；结合已亮牌、公开断门、剩余张数和残局后果判断，不能改称稳赢。首攻也要为搭档创造跑分机会：自己大副很有把握、对手通常须跟、搭档已断门时，可以让搭档垫分而非逼其将吃；反之避免用弱副对子反复消耗搭档主牌。留好必要进手、树立长套，调主必须有保护长套或消耗敌将的目的；搭档领过某门只说明公开行动，不是约定暗号或长套证明。抢/守80和末墩仍优先。',
  en:'partnershipRead adds partnership reading. declarations retains every accepted bid and overcall, its order, single/pair strength and the later location of exposed cards; an overcall does not erase evidence. No bid or no overcall is not proof of missing cards. ownSuits describes your short point holdings, structures and public play. When opponents must still follow and cannot beat partner, actively cash/feed points instead of waiting until last seat or protecting an expendable weak pair. low_reference_risk is only a low-risk uniform-allocation reference, never knowledge of actual hands; consider exposed cards, proven voids, counts and ending consequences without relabeling it certain. On lead, a strong side-suit winner against opponents likely to follow can let a void partner discard points without ruffing; avoid repeatedly forcing partner to spend trump on weak side pairs. Preserve necessary entries, establish length and draw trumps for a concrete plan. A partner\'s public lead is evidence of an action, not an agreed signal or proof of length. The 80-point race and final trick retain priority.',
};
export function pointFeedPrompt(read,cooperation,language){
  if(cooperation?.comparisons?.clinchesAttackWin?.length||!read?.trick?.partnerWinning)return '';
  if(read.trick.avoidBlindFeed){
    const cheap=cooperation?.comparisons?.economicalPartnerSupport||[],voids=read.trick.counters.filter(c=>c.provenVoid).map(c=>c.seat);
    const zero=cooperation?.trick?.pointsOnTable===0&&!read.trick.finalTrick;
    return language==='zh'?'\n本次并非跑分窗口：'+(voids.length?'剩余对手 '+voids.join('/')+' 已被公开出牌证明断门，不能再假设其必须跟牌。':'尚有压大/将吃风险，当前资料不足以支持低风险上分。')+
      '不要盲送10/K。'+(zero&&cheap.length?'这还是无分墩，优先比较 move_id '+cheap.join('/')+' 的低成本支持；不要为强保这一墩花掉王或大主。':'如要接手保护已有分数，先比较盖牌的实际价值。'):
      '\nThis is NOT a point-cashing window: '+(voids.length?'remaining opponent seats '+voids.join('/')+' have proven voids; do not assume they must follow. ':'higher-card/ruff risk remains, without evidence for a low-risk feed. ')+
      'Do not blindly donate 10/K. '+(zero&&cheap.length?'This is also a zero-point trick: prioritize economical support in move_id '+cheap.join('/')+' instead of insuring it with a joker or high trump.':'Compare the actual value of overtaking to protect points already on the table.');
  }
  if(!read.preferredPointFeeds?.length)return '';
  const ids=read.preferredPointFeeds.join('/'),proven=read.trick.partnerWindow==='proven';
  return language==='zh'?'\n本次跑分窗口：搭档'+(proven?'已稳拿':'在明确标注的分牌参照下被反超风险低，但并非保证')+'。优先比较 move_id '+ids+' 的分牌兑现；不要仅因还剩一家未出就机械垫0分。仍核对拆牌、关键进手及末墩代价。':
    '\nPoint-cashing window: partner '+(proven?'is secured':'has low counter risk under the stated allocation reference, not a guarantee')+'. Prioritize the point feed in move_id '+ids+'; do not mechanically discard zero merely because another seat remains. Check structural, entry and final-trick costs.';
}
