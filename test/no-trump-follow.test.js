import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck } from '../src/cards.js';
import { classify, enumerateLegalFollows, followError, resolveTrick, DEFAULT_RULES } from '../src/rules.js';
import { followPrompt, selectionError } from '../public/hand-tools.js';
import { trickMarkup } from '../public/pixel-view.js';

const deck=makeDeck(),one=(s,r)=>deck.find(c=>c.suit===s&&c.rank===r),pair=(s,r)=>deck.filter(c=>c.suit===s&&c.rank===r);
const game={id:'no-trump-follow',viewer:0,events:[],tricks:[],trump:{suit:null,rank:2},rules:DEFAULT_RULES,
  pending:{seat:0,phase:'follow'},seats:['南家','东家','北家','西家'].map(name=>({name})),
  hand:[one('D',2),one('H',2),one('D',14),one('D',12),...pair('D',7)],
  plays:[{seat:1,cards:pair('X',16)},{seat:2,cards:pair('D',8)},{seat:3,cards:pair('C',2)}]};
const ids=cards=>cards.map(c=>c.id),lead=classify(game.plays[0].cards,game.trump);

test('no-trump joker pair requires both held level singles before any side-suit pair',()=>{
  assert.equal(lead.suit,'T');
  assert.deepEqual(enumerateLegalFollows(game.hand,lead,game.trump),[ids(game.hand.slice(0,2))]);
  assert.equal(selectionError(game,ids(game.hand.slice(0,2))),null);
  assert.match(selectionError(game,ids(pair('D',7))),/2 张主牌.*所有 2/);
  assert.equal(followPrompt(game),'跟出 2 张主牌');
  assert.equal(resolveTrick([...game.plays,{seat:0,cards:game.hand.slice(0,2)}],game.trump).winner,1);
});

test('no trumps permits a side pair; one remaining trump must be accompanied by one discard',()=>{
  const empty={...game,hand:game.hand.slice(2)};
  assert.equal(selectionError(empty,ids(pair('D',7))),null);
  assert.equal(followPrompt(empty),'跟出 2 张 · 已无主牌');
  const partial={...game,hand:game.hand.filter(c=>c.id!==one('H',2).id)};
  assert.equal(selectionError(partial,ids([one('D',2),one('D',7)])),null);
  assert.match(selectionError(partial,ids(pair('D',7))),/先跟 1 张主牌/);
  assert.equal(followPrompt(partial),'跟出 2 张 · 先跟 1 张主牌');
});

test('a held pair of level cards must follow the joker pair; mixed level singles are not a pair',()=>{
  const hand=[...game.hand,pair('D',2)[1]];
  assert.equal(followError(hand,pair('D',2),lead,game.trump),null);
  assert.equal(followError(hand,game.hand.slice(0,2),lead,game.trump),'有对子时必须跟足对子');
  const ordinary={...game,trump:{suit:'H',rank:3},plays:[{seat:1,cards:pair('D',8)}]};
  assert.equal(selectionError(ordinary,ids(pair('D',7))),null);
  assert.equal(followPrompt(ordinary),'跟出 2 张方块');
});

test('pair captions identify the actual first lead rather than relying on screen position',()=>{
  const html=trickMarkup(game,null);
  assert.equal((html.match(/class="play-caption"/g)||[]).length,3);
  assert.match(html,/<span class="play-seat">东家<\/span><span> · 领出 · 2 张/);
  assert.match(html,/<span class="play-seat">北家<\/span><span> · 对子 · 2 张/);
  assert.match(html,/<span class="play-seat">西家<\/span><span> · 对子 · 2 张/);
  assert.match(html,/aria-label="东家 · 领出 · 对子/);
});
