import {makeDeck,effectiveSuit} from '../../src/cards.js';
import {DEFAULT_RULES} from '../../src/rules.js';
const deck=makeDeck();
export const card=(s,r,copy=0)=>deck.find(c=>c.suit===s&&c.rank===r&&Math.floor(c.id/54)===copy);
const pair=(s,r)=>[card(s,r),card(s,r,1)],play=(seat,cards)=>({seat,cards});
const base={seat:0,myTeam:0,phase:'follow',trump:{suit:'C',rank:2},trumpRank:2,handSizes:[25,25,24,24],history:[],buriedKnown:[],declarations:[],
  declSeat:0,dealer:0,dealerKnown:true,levels:[2,2],played:[-1,-1],gates:[],rules:{...DEFAULT_RULES,gates:[]},attackPoints:0,dealt:100};
const cases=[
  {id:'early-ace-cash-ten',purpose:'Cash ten under partner ace when a remaining opponent is overwhelmingly likely to follow.',hand:[card('S',10),card('S',5),card('S',6)],accept:[[card('S',10).id]]},
  {id:'early-ace-cash-king',purpose:'Cash a short-suit king instead of reflexively saving points.',hand:[card('S',13),card('S',5),card('S',6)],accept:[[card('S',13).id]]},
  {id:'established-king-cash-ten',purpose:'Both aces are public, making partner king the established side-suit master.',
    hand:[card('S',10),card('S',5),card('S',8)],view:{handSizes:[24,24,23,23],history:[play(0,[card('S',14)]),play(1,[card('S',4)]),play(2,[card('S',14,1)]),play(3,[card('S',7)])],plays:[play(2,[card('S',13)]),play(3,[card('S',3)])]},accept:[[card('S',10).id]]},
  {id:'queen-still-has-higher-counters',purpose:'Do not feed ten into a queen with unlocated kings and aces.',
    hand:[card('S',10),card('S',4),card('S',6)],view:{plays:[play(2,[card('S',12)]),play(3,[card('S',3)])]},accept:[[card('S',4).id],[card('S',6).id]]},
  {id:'proven-void-is-not-safe',purpose:'A proven void invalidates the early-ace feed window.',hand:[card('S',10),card('S',4),card('S',6)],
    view:{handSizes:[24,24,23,23],history:[play(0,[card('S',9)]),play(1,[card('D',3)]),play(2,[card('S',8)]),play(3,[card('S',7)])]},accept:[[card('S',4).id],[card('S',6).id]]},
  {id:'side-ace-pair-cash-twenties',purpose:'Use a likely safe matching pair to cash twenty points.',hand:[...pair('S',10),...pair('S',4)],
    view:{handSizes:[25,25,23,23],plays:[play(2,pair('S',14)),play(3,pair('S',3))]},accept:[pair('S',10).map(c=>c.id)]},
  {id:'small-joker-is-not-master',purpose:'Higher unlocated jokers make this zero-point partner trick provisional.',hand:[card('C',10),card('C',4)],
    view:{plays:[play(2,[card('X',15)]),play(3,[card('C',3)])]},accept:[[card('C',4).id]]},
  {id:'overcalled-bid-remains-evidence',purpose:'Retain a nondealer\'s exposed level card after a later accepted overcall.',
    hand:[card('S',10),card('S',5),card('S',6),...pair('C',2)],view:{declarations:[{seat:1,suit:'H',strength:1,cards:[card('H',2)]},{seat:0,suit:'C',strength:2,cards:pair('C',2)}]},accept:[[card('S',10).id]]},
];
export function partnershipReadCases(rotations=[0,1]){
  return cases.flatMap(item=>rotations.map(rotation=>{
    const view=structuredClone({...base,plays:[play(2,[card('S',14)]),play(3,[card('S',3)])],...item.view});
    const used=new Set([...view.history,...view.plays].flatMap(p=>p.cards).map(c=>c.id));
    const exposed=new Set(view.declarations.filter(d=>d.seat!==view.seat).flatMap(d=>d.cards).map(c=>c.id));
    const initial=new Set(item.hand.map(c=>c.id)),suit=effectiveSuit(view.plays[0].cards[0],view.trump);
    view.hand=[...item.hand,...deck.filter(c=>!initial.has(c.id)&&!used.has(c.id)&&!exposed.has(c.id)&&effectiveSuit(c,view.trump)!==suit)].slice(0,view.handSizes[0]);
    const rotate=seat=>(seat+rotation)%4;view.seat=rotate(view.seat);view.myTeam=view.seat%2;view.declSeat=rotate(view.declSeat);view.dealer=rotate(view.dealer);
    view.handSizes=Array.from({length:4},(_,i)=>view.handSizes[(i-rotation+4)%4]);
    for(const p of [...view.history,...view.plays,...view.declarations])p.seat=rotate(p.seat);
    return {id:item.id+'-rotation-'+rotation,purpose:item.purpose,view,accept:item.accept};
  }));
}
