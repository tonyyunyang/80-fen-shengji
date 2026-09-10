import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck } from '../src/cards.js';
import { buildActionContext, constrainToolToObservation } from '../src/action-context.js';
import { buildRequest, toolFor, followMoves, compactObservation, requestAction } from '../src/providers.js';
import { cardPlayFixture } from '../scripts/paired-eval.mjs';
import { observation } from '../src/game.js';

const deck = makeDeck();
const c = (suit, rank, copy = 0) => deck.find(card => card.suit === suit && card.rank === rank && Math.floor(card.id / 54) === copy);
const env = { QWEN_API_KEY: 'fixture-only', QWEN_BASE_URL: 'https://example.invalid/v1' };
const seat = { provider: 'qwen', model: 'fixture' };
const base = { phase: 'lead', seat: 0, trump: { suit: 'C', rank: 2 }, declSeat: 0, dealer: 0,
  hand: [c('S',14),c('S',2),c('C',3),c('H',5)], history: [], plays: [], buriedKnown: [], declarations: [], handSizes: [4,4,4,4], rules: {}, attackPoints: 20 };

test('lead contract separates effective trumps from the printed suit without prescribing a lead', () => {
  const request = buildRequest(base, seat, { env, contextProfile: 'strategic-v2' });
  const context = JSON.parse(request.body.messages[1].content).actionContext;
  assert.equal(context.argument, 'card_ids');
  assert.deepEqual(context.handGroups.find(group => group.effectiveSuit === 'S').cards.map(card => card.id), [c('S',14).id]);
  assert.deepEqual(new Set(context.handGroups.find(group => group.effectiveSuit === 'T').cards.map(card => card.id)), new Set([c('S',2).id,c('C',3).id]));
  assert.deepEqual(request.body.tools[0].function.parameters.properties.card_ids.items.enum, base.hand.map(card => card.id));
  assert.match(context.groupMeaning, /not a complete lead menu/);
  assert.match(request.body.messages[0].content, /exactly ONE actionContext.handGroups effectiveSuit/);
  assert.equal(request.body.messages[0].content.includes('Choose the move yourself from the complete legal menu.'), false);
});

test('when follow enumeration is unavailable the tool enforces exact card count and own IDs', () => {
  const view = { ...base, phase: 'follow', plays: [{seat:3,cards:[c('D',3),c('D',4),c('D',5)]}] };
  const original = toolFor('follow', null), bounded = constrainToolToObservation(original, view, null);
  assert.equal(bounded.name, 'play_cards');
  assert.equal(bounded.parameters.properties.card_ids.minItems, 3);
  assert.equal(bounded.parameters.properties.card_ids.maxItems, 3);
  assert.equal(original.parameters.properties.card_ids.minItems, 1);
  const context = buildActionContext(view, null, original);
  assert.equal(context.requiredCount, 3);
  assert.match(context.instruction, /No move_id exists/);
});

test('complete follow menu stays complete and has distinct menu IDs', () => {
  const view = {...base,phase:'follow',plays:[{seat:3,cards:[c('S',7)]}],hand:[c('S',3),c('S',5),c('S',13)]};
  const moves = followMoves(view), a = compactObservation(view,moves,'tactical'), b = compactObservation(view,moves,'strategic-v2');
  assert.deepEqual(a.legalMoves, b.legalMoves);
  const request = buildRequest(view,seat,{env,contextProfile:'strategic-v2'});
  assert.deepEqual(request.body.tools[0].function.parameters.properties.move_id.enum, moves.map((_,id)=>id));
  assert.equal(b.v, 6);
  assert.equal(b.actionContext.handGroups, undefined);
});

test('declaration and burial constrain only publicly offered choices or the acting hand', () => {
  const declaration = {...base,phase:'declare',options:[{id:'S-1'}]};
  assert.deepEqual(constrainToolToObservation(toolFor('declare'),declaration,null).parameters.properties.choice.enum,['pass','S-1']);
  const bury = {...base,phase:'bury',hand:deck.slice(0,33)};
  const tool = constrainToolToObservation(toolFor('bury'),bury,null);
  assert.equal(tool.parameters.properties.card_ids.minItems,8);
  assert.equal(tool.parameters.properties.card_ids.maxItems,8);
  assert.equal(tool.parameters.properties.card_ids.items.enum.length,33);
});

test('v6 requests remain identical when hidden hands, unknown kitty, seed and quiz change', () => {
  for (const seed of [501,607,709]) {
    const state = cardPlayFixture(seed), actor = (state.dealer + 1) % 4;
    const altered = structuredClone(state), other = (actor + 1) % 4;
    [altered.hands[other][0],altered.kitty[0]] = [altered.kitty[0],altered.hands[other][0]];
    altered.seed += 99; altered.quiz = {answer:'private'};
    const options = {env,contextProfile:'strategic-v2'};
    assert.deepEqual(buildRequest(observation(state,actor),seat,options).body,buildRequest(observation(altered,actor),seat,options).body);
  }
});

test('malformed tool diagnostics retain argument categories but never raw unknown fields or text', async () => {
  const data = { choices: [{message:{content:'sensitive raw answer',tool_calls:[{function:{name:'play_cards',arguments:JSON.stringify({move_id:0,'sensitive-field':'sensitive-value'})}}]}}] };
  await assert.rejects(requestAction(base,seat,{env,contextProfile:'strategic-v2',fetchImpl:async()=>({ok:true,json:async()=>data})}), error => {
    assert.deepEqual(error.metering.argumentFields,['move_id','unexpected']);
    assert.deepEqual(error.metering.argumentValueTypes,{move_id:'number'});
    assert.equal(error.metering.toolNameMatches,true);
    assert.equal(error.metering.toolCallCount,1);
    assert.equal(JSON.stringify(error.metering).includes('sensitive'),false);
    return true;
  });
});
