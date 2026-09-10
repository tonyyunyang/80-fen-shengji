import test from 'node:test';
import assert from 'node:assert/strict';
import { handLayout } from '../public/hand-layout.js';
import { courtIndex, cardFace } from '../public/card-art.js';
import { relativePosition, resultMarkup, levelLabel, playerName, trickMarkup, arrivingCard } from '../public/pixel-view.js';
import { trainingQuestion } from '../src/training.js';

test('25 to 33 to 25 stays one row without carrying geometry from burial', () => {
  for (const width of [320,640,960,1280,1600]) {
    const first=handLayout(25,width),burial=handLayout(33,width),again=handLayout(25,width);
    assert.deepEqual(first,again);
    assert.equal(burial.rows,1);assert.equal(again.rows,1);
    assert.ok(burial.positions.every(position=>position.bottom===0));
    assert.ok(again.positions.every(position=>position.bottom===0));
    assert.ok(burial.step>=26 && again.step>=26);
    assert.ok(burial.positions.at(-1).left+burial.cardWidth<=burial.contentWidth+.001);
  }
});
test('fresh empty sessions connect safely and card arrivals remain scoped to a deal', () => {
  assert.equal(arrivingCard(null,null),null);
  assert.equal(arrivingCard(undefined,null),null);
  const card={id:1,suit:'S',rank:3},game={id:'one',dealing:'continuous',phase:'dealing',hand:[card]};
  assert.equal(arrivingCard(null,game),card);
  assert.equal(arrivingCard(game,game),null);
  assert.equal(arrivingCard(game,{...game,id:'two'}),card);
  assert.equal(arrivingCard(null,{...game,phase:'bury'}),null);
});
test('every viewer has the partner across the table and the correct two opponents at the sides', () => {
  for(let viewer=0;viewer<4;viewer++){
    const game={viewer};
    assert.equal(relativePosition(game,viewer),'south');
    assert.equal(relativePosition(game,(viewer+2)%4),'north');
    assert.equal(relativePosition(game,(viewer+1)%4),'east');
    assert.equal(relativePosition(game,(viewer+3)%4),'west');
  }
});
test('changing the viewing seat never labels another player with the default You name', () => {
  const game={viewer:1,seats:[{name:'You'},{name:'East'},{name:'North'},{name:'West'}]};
  assert.match(playerName(game,0),/南家|South/);
  assert.match(playerName({...game,viewer:0},0),/你|You/);
});
test('narrow played fans retain the full count and full accessible card list', () => {
  const game={id:'test',viewer:0,events:[],tricks:[],trump:{suit:'S',rank:2},seats:Array.from({length:4},(_,seat)=>({name:'Seat '+seat})),plays:[{seat:1,cards:[3,4,5,6].map((rank,id)=>({id,suit:'H',rank}))}]};
  const html=trickMarkup(game,null,true);
  assert.equal((html.match(/class="flip-card"/g)||[]).length,2);
  assert.match(html,/\+2/);
  assert.match(html,/♥6/);
  assert.match(html,/4 张|4 cards/);
});
test('court illustrations map to all twelve faces; jokers use pictures without HI/LO indices', () => {
  const indices=[];
  for(const suit of ['S','H','C','D'])for(const rank of [11,12,13])indices.push(courtIndex({suit,rank}));
  assert.deepEqual(indices,Array.from({length:12},(_,index)=>index));
  assert.equal(courtIndex({suit:'X',rank:15}),12);assert.equal(courtIndex({suit:'X',rank:16}),13);
  for(const rank of [15,16]){const art=cardFace({suit:'X',rank});assert.match(art,/joker-art/);assert.equal(/HI|LO|style=/.test(art),false);}
});
test('the result screen attributes an 80-point takeover to the attacking team', () => {
  const base={viewer:0,dealer:0,score:{attackersWin:true,total:80,attackPoints:60,kittyPoints:5,multiplier:4},tricks:[{winner:1}],match:{winner:-1,round:1,levels:[2,2]},kitty:[],phase:'round_over'};
  assert.match(resultMarkup(base),/对方获胜|Opponents win/);
  assert.match(resultMarkup({...base,viewer:1}),/我方胜利|Our team wins/);
  assert.match(resultMarkup(base),/id="nextDeal"/);
});
test('passing A is a completed match and never displays a joker level', () => {
  assert.match(levelLabel(15),/通关|Complete/);
  assert.equal(levelLabel(14),'A');
});
test('learning opened after a completed deal supplies a public recap even with no unplayed cards', () => {
  const view={viewer:0,dealer:0,trump:{suit:'S',rank:2},seats:Array.from({length:4},(_,seat)=>({name:'Seat '+seat})),tricks:[{winner:1}],score:{kittyPoints:0,multiplier:4}};
  const original=structuredClone(view),question=trainingQuestion(view,'en');
  assert.equal(question.options.length,2);
  assert.match(question.correct[0],/Attackers/);
  assert.match(question.explanation,/added 0 attacker points/);
  assert.deepEqual(view,original);
  assert.match(trainingQuestion({...view,tricks:[{winner:2}]},'en').correct[0],/Defenders/);
});

test('only accepted current-deal declarations are displayed and they return after settlement', async () => {
  const {displayedDeclarations,declarationMarkup,dealMarkers}=await import('../public/pixel-view.js');
  const card={id:1,suit:'H',rank:2},second={...card,id:55};
  const game={id:'declared',phase:'closing',viewer:0,dealer:0,attackPoints:35,trumpRank:2,trump:null,tricks:[],seats:Array.from({length:4},()=>({name:'Seat'})),match:{dealer:0,levels:[2,2]},declaration:{seat:2,suit:'H'},events:[
    {seq:0,type:'declaration',seat:1,cards:[{...card,id:3}]},{seq:1,type:'deal_started'},
    {seq:2,type:'declaration',seat:2,cards:[card]},{seq:3,type:'declaration',seat:2,cards:[card,second]},
  ]};
  assert.deepEqual(displayedDeclarations(game),[{seat:2,cards:[card,second]}]);
  assert.match(declarationMarkup(game),/declaration-pile north current/);
  assert.deepEqual(displayedDeclarations({...game,phase:'bury'}),[]);
  assert.match(dealMarkers(game),/我方 · 防守|WE DEFEND/);assert.match(dealMarkers(game),/对方攻分|Opponent points/);
  assert.match(dealMarkers({...game,viewer:1}),/我方 · 攻击|WE ATTACK/);
});
