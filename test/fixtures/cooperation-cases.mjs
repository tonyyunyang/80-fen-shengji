import {makeDeck} from '../../src/cards.js';
import {DEFAULT_RULES} from '../../src/rules.js';

// Synthetic tactical observations, never private player replays. Omitted
// earlier cards stay unlocated, so these are not whole-deal strength fixtures.
const deck=makeDeck();
const c=(s,r,copy=0)=>deck.find(c=>c.suit===s&&c.rank===r&&Math.floor(c.id/54)===copy);
const pair=(s,r)=>[c(s,r),c(s,r,1)];
const base={schemaVersion:1,ruleset:'synthetic-cooperation',seat:0,myTeam:0,phase:'follow',trump:{suit:'C',rank:2},trumpRank:2,
  hand:[],handSizes:[3,3,2,2],history:[],plays:[],buriedKnown:[],declarations:[],declSeat:0,dealer:0,dealerKnown:true,
  levels:[2,2],played:[-1,-1],gates:[],rules:{...DEFAULT_RULES,gates:[]},attackPoints:0};
const play=(seat,cards)=>({seat,cards});
const sets=(...hands)=>hands.map(hand=>hand.map(c=>c.id));
const topTrick=[play(2,[c('X',16)]),play(3,[c('C',3)])];
const ruffHistory=[play(0,[c('S',6)]),play(1,[c('H',4)]),play(2,[c('S',9)]),play(3,[c('S',8)])];
const cases=[
  {id:'feed-five-under-top-joker',purpose:'Cash a safe five while retaining the equal big joker.',
    view:{hand:[c('X',16,1),c('C',5),c('C',6)],plays:topTrick},accept:sets([c('C',5)])},
  {id:'save-equal-big-joker',purpose:'Do not waste an equal top joker on a partner-controlled zero-point trick.',
    view:{hand:[c('X',16,1),c('C',4),c('C',6)],plays:topTrick},accept:sets([c('C',4)],[c('C',6)])},
  {id:'feed-ten-under-top-joker',purpose:'Cash ten rather than a zero-point card on a secure partner trick.',
    view:{hand:[c('X',15),c('C',10),c('C',6)],plays:topTrick},accept:sets([c('C',10)])},
  {id:'last-seat-point-feed',purpose:'Bank ten without overtaking partner or using an ace entry.',
    view:{seat:3,myTeam:1,declSeat:1,dealer:1,hand:[c('S',5),c('S',10),c('S',14)],
      plays:[play(0,[c('S',9)]),play(1,[c('S',12)]),play(2,[c('S',11)])]},accept:sets([c('S',10)])},
  {id:'zero-point-ruff-risk',purpose:'Support cheaply, without feeding ten into a possible ruff or spending a big joker on zero points.',
    view:{hand:[c('X',16),c('D',10),c('D',3)],history:ruffHistory,plays:[play(2,[c('S',14)]),play(3,[c('S',7)])]},accept:sets([c('D',3)])},
  {id:'cover-to-secure-eighty',purpose:'Spend the big joker when that guarantees the attacking partnership reaches 80.',
    view:{declSeat:1,dealer:1,attackPoints:70,hand:[c('X',16),c('D',10),c('D',3)],plays:[play(2,[c('S',14)]),play(3,[c('S',13)])]},accept:sets([c('X',16)])},
  {id:'last-seat-save-ace',purpose:'Leave partner on lead and retain an ace on a zero-point trick.',
    view:{seat:3,myTeam:1,declSeat:1,dealer:1,hand:[c('H',14),c('H',4),c('H',6)],
      plays:[play(0,[c('H',8)]),play(1,[c('H',11)]),play(2,[c('H',7)])]},accept:sets([c('H',4)],[c('H',6)])},
  {id:'overtake-for-point-win',purpose:'Overtaking partner is correct when our king secures the 80-point win.',
    view:{seat:3,myTeam:1,declSeat:0,dealer:0,attackPoints:70,hand:[c('S',13),c('S',4),c('S',6)],
      plays:[play(0,[c('S',8)]),play(1,[c('S',9)]),play(2,[c('S',7)])]},accept:sets([c('S',13)])},
  {id:'lost-pair-retain-controls',purpose:'An unbeatable enemy joker pair cannot be recovered; retain the unpaired level trump.',
    view:{hand:[c('H',2),c('C',3),c('C',4)],handSizes:[3,3,3,1],plays:[play(3,pair('X',16))]},accept:sets([c('C',3),c('C',4)])},
  {id:'cheapest-secure-takeover',purpose:'Take a completed zero-point enemy trick with queen, preserving both jokers.',
    view:{seat:3,myTeam:1,declSeat:1,dealer:1,hand:[c('C',12),c('X',15),c('X',16)],
      plays:[play(0,[c('C',11)]),play(1,[c('C',7)]),play(2,[c('C',9)])]},accept:sets([c('C',12)])},
  {id:'feed-pair-keep-level-pair',purpose:'Feed the fives under partner\'s top pair while retaining the level pair.',
    view:{hand:[...pair('C',5),...pair('H',2)],handSizes:[4,4,2,2],plays:[play(2,pair('X',16)),play(3,pair('C',3))]},accept:sets(pair('C',5))},
  {id:'pair-ruff-risk-no-blind-feed',purpose:'Do not donate fives when the remaining opponent can overruff; a zero-point pair is acceptable.',
    view:{hand:[...pair('C',4),...pair('D',5),...pair('D',6)],handSizes:[6,6,4,4],history:ruffHistory,
      plays:[play(2,pair('S',14)),play(3,pair('S',7))]},accept:sets(pair('C',4),pair('D',6))},
];

export function cooperationCases(rotations=[0,2]){
  return cases.flatMap(item=>rotations.map(rotation=>{
    const view=structuredClone({...base,...item.view}),rotate=seat=>(seat+rotation)%4;
    view.seat=rotate(view.seat);view.myTeam=view.seat%2;view.declSeat=rotate(view.declSeat);view.dealer=rotate(view.dealer);
    view.handSizes=Array.from({length:4},(_,i)=>view.handSizes[(i-rotation+4)%4]);
    for(const p of [...view.history,...view.plays,...view.declarations])p.seat=rotate(p.seat);
    return {...item,id:item.id+'-rotation-'+rotation,view};
  }));
}
export const matchesAccepted=(item,action)=>item.accept.some(ids=>ids.length===action?.cardIds?.length&&ids.every(id=>action.cardIds.includes(id)));
