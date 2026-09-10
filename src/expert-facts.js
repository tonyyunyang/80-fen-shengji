import { cardLabel, effectiveSuit, order, points, faceKey } from './cards.js';

// Exhaustive descriptive facts, not a policy or a ranked candidate shortlist.
// The only argument carrying game information is the acting seat observation.
export function buildExpertFacts(view, moves, compact) {
  if (!view.trump || !['lead','follow','bury'].includes(view.phase)) return null;
  const hand=view.hand, trump=view.trump, partnership=compact.partnership;
  const faces=new Map();
  for(const card of hand){const key=faceKey(card);if(!faces.has(key))faces.set(key,[]);faces.get(key).push(card);}
  const ownFaces=[...faces.values()].map(cards=>{
    const card=cards[0],suit=effectiveSuit(card,trump),above=(compact.notebook.suits.find(s=>s.suit===suit)?.unlocatedFaces||[]).filter(([s,r])=>order({suit:s,rank:r},trump)>order(card,trump));
    return {card_ids:cards.map(c=>c.id),face:cardLabel(card),effectiveSuit:suit,order:order(card,trump),pointsEach:points([card]),
      higherUnlocatedCopies:above.reduce((sum,[,,n])=>sum+n,0),higherUnlocatedPairFaces:above.filter(([,,n])=>n===2).map(([s,r])=>cardLabel({suit:s,rank:r})),
      opponentsProvenVoid:partnership.opponents.filter(seat=>compact.notebook.provenVoids.some(v=>v.seat===seat&&v.suit===suit))};
  });
  const tablePoints=points(view.plays.flatMap(p=>p.cards));
  return {ownFaces,moves:moves?.map((ids,id)=>{
    const chosen=hand.filter(c=>ids.includes(c.id)),left=hand.filter(c=>!ids.includes(c.id));
    const fact=compact.decisionContext.moves[id],outcome=partnership.certainMoveOutcomes[id].teamTrickOutcome;
    const secured=outcome==='secured',lost=outcome==='lost';
    return {move_id:id,card_ids:ids,faces:chosen.map(cardLabel),teamOutcome:outcome,winningSeat:fact.winnerSoFar,
      pointsInPlayedCards:points(chosen),pointsOurTeamSecures:secured?tablePoints+points(chosen):null,pointsOpponentsSecure:lost?tablePoints+points(chosen):null,
      highTrumpsUsed:chosen.filter(c=>c.suit==='X'||c.rank===trump.rank).map(cardLabel),pairsBroken:fact.pairsBroken,
      remainingSuits:['T','S','H','D','C'].filter(s=>s!==trump.suit).map(s=>({suit:s,count:left.filter(c=>effectiveSuit(c,trump)===s).length})),
      remainingPairs:fact.pairsRemaining,remainingLongestTractor:fact.longestTractorPairsRemaining};
  })||null};
}
export const EXPERT_FACTS_PROMPT = {
  zh:'expertFacts把每个合法动作的牌面、团队结果、分数去向和留下的牌型放在同一行，不是建议出牌。pointsOurTeamSecures是我方锁定的分，攻守双方都希望自己的分牌被自己一队收走；防守时这虽不增加记分牌数字，却避免以后被攻方抓分。pointsInPlayedCards不是要最小化的费用。稳赢且结构、进手代价相近时，优先兑现更多分牌；不要无理由垫0分却留着难跑的10/K。ownFaces逐面列出可能更大的未定位牌；甩AK前应检查K上面是否还有未定位A，不能仅因自己持有A就把K当成大牌。higherUnlocatedPairFaces表示可能更大的对子牌面，不表示某人一定持有。无论哪一项，未定位都包含未知底牌，不等于实际敌手持牌。',
  en:'expertFacts joins face labels, team outcomes, point destinations and retained structures for EVERY legal move; it is not move advice. pointsOurTeamSecures means points locked for OUR team: both attackers and defenders want their point cards captured by their own partnership. On defense these do not increase the scoreboard but cannot be captured by attackers later. pointsInPlayedCards is not a cost to minimize. When secured outcomes and structural/entry costs are comparable, cash more points; do not discard zero while keeping a stranded 10/K without a reason. ownFaces lists possibly higher unlocated cards for every face; before throwing AK, check for an unlocated ace above K rather than treating K as top merely because you own an ace. higherUnlocatedPairFaces lists possible higher pair faces, not known holdings. Unlocated always includes the unknown kitty and is not an actual opponent hand.',
};
