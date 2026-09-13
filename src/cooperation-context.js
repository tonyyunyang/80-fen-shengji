import {makeDeck,effectiveSuit,order,points,cardLabel} from './cards.js';
import {classify,groups,resolveTrick} from './rules.js';
import {publicPlays} from './notebook.js';

const signature=shape=>shape.parts.map(p=>p.type+(p.type==='tractor'?p.len:'')).sort().join(',');
const relation=(seat,you)=>seat===you?'you':seat===(you+2)%4?'partner':'opponent';
const compare=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;};
const minima=(rows,key)=>{
  if(!rows.length)return [];
  const best=rows.reduce((a,b)=>compare(key(a),key(b))<=0?a:b);
  return rows.filter(row=>compare(key(row),key(best))===0).map(row=>row.move_id);
};

// A conservative superset of possible holdings. Revealed dealer cards can be
// in that dealer's hand OR the kitty, never another seat's hand. Unknown cards
// are not assigned to a real opponent or sampled as if they were known.
function possibleHoldings(view,notebook,seat){
  const gone=new Set([...publicPlays(view).flatMap(p=>p.cards),...view.hand,...(view.buriedKnown||[])].map(c=>c.id));
  const owners=new Map();
  for(const d of view.declarations||[])for(const card of d.cards||[])if(!gone.has(card.id))owners.set(card.id,d.seat);
  const voids=new Set(notebook.provenVoids.filter(v=>v.seat===seat).map(v=>v.suit));
  const pool=makeDeck().filter(c=>!gone.has(c.id)&&(!owners.has(c.id)||owners.get(c.id)===seat)&&!voids.has(effectiveSuit(c,view.trump)));
  const dealer=view.declSeat>=0?view.declSeat:view.dealerKnown?view.dealer:null;
  const fixed=makeDeck().filter(c=>owners.get(c.id)===seat&&seat!==dealer);
  const size=view.handSizes[seat];
  const consistent=Number.isInteger(size)&&pool.length>=size&&fixed.length<=size&&fixed.every(c=>!voids.has(effectiveSuit(c,view.trump)));
  return {pool,fixed,size,voids,consistent};
}

function matchingPackets(pool,lead,trump){
  if(lead.type==='single')return {packets:pool.map(c=>[c]),complete:true};
  const pairs=groups(pool).filter(g=>g.length===2);
  if(lead.type==='pair')return {packets:pairs,complete:true};
  if(lead.type!=='tractor')return {packets:[],complete:false};
  const byOrder=new Map();
  for(const pair of pairs){const rank=order(pair[0],trump);if(!byOrder.has(rank))byOrder.set(rank,[]);byOrder.get(rank).push(pair);}
  const packets=[];let complete=true;
  const walk=(rank,left,cards)=>{
    if(packets.length>=128){complete=false;return;}
    if(!left){packets.push(cards);return;}
    for(const pair of byOrder.get(rank)||[])walk(rank+1,left-1,[...cards,...pair]);
  };
  for(const start of byOrder.keys())walk(start,lead.len,[]);
  return {packets,complete};
}

function threatEnvelope(view,notebook,lead,seat){
  const {pool,fixed,size,voids,consistent}=possibleHoldings(view,notebook,seat),trump=view.trump;
  const minimumLed=Math.max(fixed.filter(c=>effectiveSuit(c,trump)===lead.suit).length,size-pool.filter(c=>effectiveSuit(c,trump)!==lead.suit).length,0);
  const result={seat,relation:relation(seat,view.seat),provenVoidInLedSuit:voids.has(lead.suit),minimumLedCards:minimumLed,
    strongestPossibleFollow:null,strongestPossibleRuff:null,complete:consistent};
  for(const suit of [lead.suit,...(lead.suit!=='T'&&minimumLed===0?['T']:[])]){
    const {packets,complete}=matchingPackets(pool.filter(c=>effectiveSuit(c,trump)===suit),lead,trump);
    result.complete&&=complete;
    for(const packet of packets){
      if(new Set([...fixed,...packet].map(c=>c.id)).size>size)continue;
      const shape=classify(packet,trump);if(!shape||signature(shape)!==signature(lead))continue;
      const key=suit===lead.suit?'strongestPossibleFollow':'strongestPossibleRuff';
      result[key]=Math.max(result[key]??-1,shape.top);
    }
  }
  return result;
}
const couldBeat=(threat,winning)=>!threat.complete ||
  (winning.suit==='T'? (threat.strongestPossibleRuff??-1)>winning.top || (threat.strongestPossibleFollow??-1)>winning.top&&threat.ledSuit==='T':
    threat.strongestPossibleRuff!==null || (threat.strongestPossibleFollow??-1)>winning.top);

// Only own/public observations enter. Suggestions compare immediate trick
// outcomes and resource costs; they are not claims of globally optimal play.
export function buildCooperationContext(view,moves,compact){
  if(!view.trump||!['lead','follow'].includes(view.phase))return null;
  const notebook=compact.notebook,team=compact.partnership,decision=compact.decisionContext,trump=view.trump;
  const history=publicPlays(view),completed=[];
  for(let i=0;i+3<history.length;i+=4){const plays=history.slice(i,i+4),result=resolveTrick(plays,trump);completed.push({plays,...result});}
  const recentLeads=completed.slice(-6).map(trick=>({seat:trick.plays[0].seat,relation:relation(trick.plays[0].seat,view.seat),
    suit:effectiveSuit(trick.plays[0].cards[0],trump),count:trick.plays[0].cards.length,winningSeat:trick.winner,points:trick.points}));
  const context={version:1,basis:'Own hand and public play only. Possible counters are conservative possibilities, not actual holdings. Public leads are observations, not agreed signals.',
    partner:team.partner,role:team.role,recentLeads,publicVoids:notebook.provenVoids,
    plan:{pointsStillNeeded:Math.max(0,80-view.attackPoints),remember:'Win as a partnership; keep separate entries and use safe team tricks to carry point cards.'}};
  if(!view.plays.length)return {context,rows:[],outcomes:null};
  const lead=classify(view.plays[0].cards,trump),after=team.trick.afterYou.map(p=>p.seat);
  const threats=after.map(seat=>({...threatEnvelope(view,notebook,lead,seat),ledSuit:lead.suit}));
  const assess=plays=>{
    const winner=resolveTrick(plays,trump).winner,winning=classify(plays.find(p=>p.seat===winner).cards,trump);
    const ourWinner=winner%2===view.seat%2,opposing=threats.filter(t=>(t.seat%2===view.seat%2)!==ourWinner);
    const mayChange=opposing.filter(t=>couldBeat(t,winning)).map(t=>t.seat);
    return {winner,teamOutcome:mayChange.length?'unsettled':ourWinner?'secured':'lost',mayChange};
  };
  const before=assess(view.plays);
  context.trick={partnerWinning:before.winner===team.partner,winningSeat:before.winner,pointsOnTable:team.trick.points,
    afterYou:team.trick.afterYou,partnerControl:before.winner===team.partner?before.teamOutcome:null,threats,
    finalTrick:view.hand.length===lead.cards.length};
  const rows=(moves||[]).map((ids,id)=>{
    const cards=view.hand.filter(c=>ids.includes(c.id)),outcome=assess([...view.plays,{seat:view.seat,cards}]),fact=decision.moves[id];
    const control=cards.filter(c=>effectiveSuit(c,trump)==='T'?(c.suit==='X'||c.rank===trump.rank):
      !(notebook.suits.find(s=>s.suit===effectiveSuit(c,trump))?.unlocatedFaces||[]).some(([s,r])=>order({suit:s,rank:r},trump)>order(c,trump)));
    return {move_id:id,teamOutcome:outcome.teamOutcome,winningSeat:outcome.winner,counterSeats:outcome.mayChange,
      keepsPartnerWinning:outcome.winner===team.partner,controlsUsed:control.map(cardLabel),controlCost:control.length,
      highTrumpCount:cards.filter(c=>c.suit==='X'||c.rank===trump.rank).length,trumpsUsed:fact.trumpsSpent,
      pairsBroken:fact.pairsBroken,tractorDamage:Math.max(0,...decision.handShape.map(s=>s.longestTractorPairs))-fact.longestTractorPairsRemaining,
      orderCost:cards.reduce((sum,c)=>sum+order(c,trump)+1,0),pointCards:points(cards),visiblePoints:team.trick.points+points(cards)};
  });
  const resource=row=>[row.highTrumpCount,row.controlCost,row.pairsBroken,Math.max(0,row.tractorDamage),row.trumpsUsed];
  const secured=rows.filter(r=>r.teamOutcome==='secured');
  const clinchers=team.role==='attack'&&view.attackPoints<80?secured.filter(r=>view.attackPoints+r.visiblePoints>=80):[];
  const bankable=(clinchers.length?clinchers:secured).filter(r=>r.pointCards>0);
  context.comparisons={
    safePointCarrying:minima(bankable,r=>[...resource(r),-r.pointCards,r.keepsPartnerWinning?0:1,r.orderCost]),
    economicalPartnerSupport:minima(rows.filter(r=>r.keepsPartnerWinning),r=>[...resource(r),r.teamOutcome==='secured'?-r.pointCards:r.pointCards,r.orderCost]),
    guaranteedProtection:before.winner===team.partner&&before.teamOutcome!=='secured'?secured.filter(r=>!r.keepsPartnerWinning).map(r=>r.move_id):[],
    leastCostSecuredTakeover:before.winner!==team.partner||team.trick.points>0?minima(secured,r=>[...resource(r),r.orderCost]):[],
    clinchesAttackWin:minima(clinchers,r=>[...resource(r),-r.pointCards,r.orderCost]),
  };
  context.plan.currentPriority=clinchers.length?'secure_the_80_point_win':before.winner===team.partner?
    before.teamOutcome==='secured'?'cash_safe_points_and_preserve_controls':team.trick.points===0&&!context.trick.finalTrick?
      'economical_support_no_automatic_expensive_cover':'weigh_protection_of_points_against_control_cost':'gain_useful_team_control_without_overpaying';
  for(const row of rows)row.cheaperSameOutcome=rows.filter(other=>other.move_id!==row.move_id&&other.winningSeat===row.winningSeat&&
    other.pointCards===row.pointCards&&other.teamOutcome===row.teamOutcome&&resource(other).every((v,i)=>v<=resource(row)[i])&&
    other.orderCost<row.orderCost).map(other=>other.move_id);
  context.comparisonMeaning='Soft recommendations, not a pruned legal menu. Same-outcome comparisons preserve the current winning seat and visible points, not every future strategic consequence. Protecting points/entries and the last trick can justify overtaking.';
  const outcomes=team.certainMoveOutcomes?.map((old,i)=>({...old,teamTrickOutcome:rows[i].teamOutcome}));
  return {context,rows,outcomes};
}

export const COOPERATION_PROMPT={
  zh:'先读cooperation，再选牌。搭档稳拿时，上分/跑分是帮自己的队，不是浪费分；参考safePointCarrying保留王、级主、进手和完整牌型。跟牌且搭档已领先时，若这一墩无分或本队已稳拿，不要无故再投一张A、王或大主；若某动作有cheaperSameOutcome，须有明确的后续计划才多花牌力。搭档只是暂大时，核对afterYou和threats：未定位牌不等于对手实际持牌，可能断门不等于已断门；对手能将吃时不可盲送10/K。guaranteedProtection表示多花控制可排除威胁，但0分墩不必自动强保；抢/守80、关键进手或保底才可能值得。把recentLeads和publicVoids作为事实读牌，不能把一次出牌当暗号或断言搭档剩余牌型。所有建议可按全局计划调整，完整合法菜单始终有效；只返回动作。',
  en:'Read cooperation before selecting. When partner securely wins, feed/carry points for YOUR team; safePointCarrying compares conservation of jokers, level trumps, entries and structures. When following with partner already ahead on a point-free or secured trick, do not throw another ace, joker or high trump away without purpose; a move with cheaperSameOutcome needs a concrete future-plan reason to spend more. When partner only leads so far, check afterYou and threats: unlocated cards are not actual opponent holdings, and possible void is not proven void. Do not blindly feed 10/K into a possible ruff. guaranteedProtection shows covers that remove uncertainty, but a zero-point trick need not be insured at any cost; the 80-point race, a critical entry or kitty control can justify it. Read recentLeads/publicVoids as facts, never an agreed signal or certainty about partner holdings. These are soft comparisons under a whole-deal plan; the complete legal menu remains available. Return only the action.',
};

// Keep an immediately provable team win visible beside the action contract;
// conservation advice must not obscure the primary partnership objective.
export function cooperationWinPrompt(context,language){
  const ids=context?.comparisons?.clinchesAttackWin;
  if(!ids?.length)return '';
  return language==='zh'?
    '\n本次优先级：你是攻方，move_id '+ids.join('/')+' 可确保本队总分达到80、锁定赢局，即使后面仍有对手。请优先从这些动作选牌；为此盖过搭档、花掉王是值得的。不要为了省牌力而选择尚不能确保赢局的动作。':
    '\nPriority THIS turn: you are attacking; move_id '+ids.join('/')+' guarantees your partnership reaches 80 and wins, even with opponents still to act. Prefer one of these moves. Overtaking partner or spending a joker is justified for a certain deal win; do not conserve resources with a move that leaves the win uncertain.';
}
