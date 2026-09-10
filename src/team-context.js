import { effectiveSuit, order, points } from './cards.js';
import { groups, resolveTrick } from './rules.js';
import { publicPlays } from './notebook.js';

// Explicit relationships eliminate the need to infer partners from seat parity.
// Every input is part of this player's own observation.
export function buildTeamContext(view, notebook = null, decisionContext = null) {
  const seat=view.seat,partner=(seat+2)%4,opponents=[(seat+1)%4,(seat+3)%4];
  const dealer=view.declSeat>=0?view.declSeat:view.dealerKnown?view.dealer:null;
  const role=dealer===null?'undecided':dealer%2===seat%2?'defend':'attack';
  const relation=player=>player===seat?'you':player===partner?'partner':'opponent';
  const current=view.plays||[],winner=current.length?resolveTrick(current,view.trump).winner:null;
  const after=current.length?Array.from({length:3-current.length},(_,i)=>(seat+i+1)%4):[];
  const score=view.attackPoints||0;
  const gone=new Set([...publicPlays(view).flatMap(play=>play.cards),...(view.buriedKnown||[])].map(card=>card.id));
  const held=new Set(view.hand.map(card=>card.id)),shown=new Map();
  for(const declaration of view.declarations||[])for(const card of declaration.cards||[]){
    if(gone.has(card.id))continue;
    shown.set(card.id,{card:[card.id,card.suit,card.rank],seat:declaration.seat,relation:relation(declaration.seat),location:held.has(card.id)?'your_hand':declaration.seat===dealer?'dealer_hand_or_kitty':'hand'});
  }
  return {
    you:seat,partner,opponents,role,dealer,
    seats:Array.from({length:4},(_,player)=>({seat:player,relation:relation(player),remainingCards:view.handSizes[player],provenVoids:(notebook?.provenVoids||[]).filter(row=>row.seat===player).map(row=>row.suit)})),
    objective:role==='defend'?'Your partnership wins if FINAL attacker points are below 80. Exactly 80 loses.':role==='attack'?'Your partnership wins if FINAL attacker points reach 80.':'Opposite seats are partners. Identify the dealer team when it is settled.',
    priorities:['Maximize partnership deal wins.','Then improve score/level outcome; individual trick count is not the objective.'],
    unplayedRevealedCards:[...shown.values()],
    scoreRace:{attackerPoints:score,pointsTo80:Math.max(0,80-score),takeoverAlreadySecured:score>=80,nextAttackLevelAt:score<80?120:80+40*(Math.floor((score-80)/40)+1)},
    trick:current.length?{winningSeat:winner,winningRelation:relation(winner),points:points(current.flatMap(play=>play.cards)),afterYou:after.map(player=>({seat:player,relation:relation(player)})),partnerCanStillPlay:after.includes(partner)}:null,
    certainMoveOutcomes:decisionContext?.moves?.map(move=>{
      const outcome=move.teamWinningSoFar&&!after.some(player=>opponents.includes(player))?'secured':!move.teamWinningSoFar&&!after.includes(partner)?'lost':'unsettled';
      const attackerPointsNow=current.length===3&&move.winnerSoFar%2!==dealer%2?points(current.flatMap(play=>play.cards))+move.pointsSpent:0;
      return {moveId:move.id,teamTrickOutcome:outcome,attackerPointsAddedNow:current.length===3?attackerPointsNow:null,clinchesAttackerTakeover:current.length===3&&score<80&&score+attackerPointsNow>=80};
    })||null,
    resources:view.trump?['T','S','H','D','C'].filter(suit=>suit!==view.trump.suit).map(suit=>{
      const cards=view.hand.filter(card=>effectiveSuit(card,view.trump)===suit);
      return {suit,count:cards.length,points:points(cards),pairs:groups(cards).filter(group=>group.length===2).length,highestOrder:cards.length?Math.max(...cards.map(card=>order(card,view.trump))):null};
    }):null,
  };
}

export const TEAM_PROMPT=[
  'Your objective is YOUR PARTNERSHIP winning the deal, not matching any reference player, winning the most individual tricks, or always playing the lowest point card.',
  'Read partnership.you, partner, opponents and role before choosing. Partner and you share the same final outcome. The two opponents share the opposite outcome.',
  'unplayedRevealedCards contains public declarations that have not been played. A nondealer still holds those cards. dealer_hand_or_kitty deliberately leaves location uncertain after burial; never treat it as a guaranteed card in that hand.',
  'Use the current score threshold: exactly 80 is an attacker win. Before that threshold, prioritize team win chances; after takeover is secured, improve the level/score outcome.',
  'A partner winning so far may still be overtaken. Check afterYou and proven voids before feeding points. If no opponent remains, bank expendable points on the partner and avoid wasting a higher winner. If the trick cannot be recovered, preserve useful trump, pairs and entries unless the immediate score threshold demands otherwise.',
  'certainMoveOutcomes are public deductions, not estimates: secured means the winning team cannot change; lost means no remaining ally can recover this trick. clinchesAttackerTakeover marks moves that immediately reach 80 after this completed trick. Seek that when attacking; avoid conceding it when a better legal alternative exists while defending.',
  'On lead, compare cashing side-suit winners, drawing trump to protect a plan, and returning the lead to partner. Save a plausible route to the last trick when kitty exposure matters; do not hoard control after its useful purpose has passed.',
  'endgameEstimates, when present, are uncertain comparisons on a small shared set of POSSIBLE hidden allocations. They are not the real hands, calibrated win probabilities or guarantees. Continuations use a fast practice rollout on each simulated seat\'s own observation, not perfect future play. Prefer robust team outcomes when the estimates and public tactical facts agree; you may choose a different legal action.',
  'The same sampled positions evaluate every listed candidate. Candidate coverage is explicitly stated. The complete legal action tool remains authoritative; an estimate list never removes legal moves.',
  'Return exactly one legal action tool promptly. Do not narrate, request hidden information, or spend the deadline describing your reasoning.',
].join('\n');

export const TEAM_ADVISOR_PROMPT='referenceAdvice is one legal candidate from the practice policy, using the same information as you. Judge it by the partnership win objective and public facts alongside other legal choices. Agreement is not rewarded, disagreement is not an error, and the reference is not assumed optimal. The final decision is yours.';
