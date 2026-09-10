import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvisorContext } from '../src/advisor-context.js';
import { followMoves, toolFor, buildRequest, requestAction } from '../src/providers.js';
import { observation, applyAction } from '../src/game.js';
import { choosePeilian } from '../src/peilian.js';
import { cardPlayFixture } from '../scripts/paired-eval.mjs';
import { Session, validateConfig } from '../server/session.js';

test('reference advice uses the preserved observation-only policy and does not mutate the hand or menu', () => {
  for (const seed of [41,43,47,53]) {
    let state=cardPlayFixture(seed);
    for(let i=0;i<24&&state.pending;i++) {
      const d=state.pending, view=observation(state,d.seat), before=structuredClone(view);
      const moves=followMoves(view), prior=structuredClone(moves), tool=toolFor(view.phase,moves);
      const advice=buildAdvisorContext(view,moves,tool), expected=choosePeilian(view,'',{deterministic:true});
      const ids=tool.name==='play_move'?moves[advice.tool.arguments.move_id]:advice.tool.arguments.card_ids;
      assert.deepEqual(new Set(ids),new Set(expected.cardIds));
      assert.deepEqual(view,before);assert.deepEqual(moves,prior);
      assert.equal(advice.policy,'peilian');
      state=applyAction(state,{decisionId:d.id,version:d.version,seat:d.seat,action:expected});
    }
  }
});

test('reference advice is invariant to hidden hands, unknown burial, seeds and quizzes', () => {
  for(const seed of [61,67,71]) {
    let state=cardPlayFixture(seed);
    while(state.pending.seat===state.dealer) {
      const d=state.pending;
      state=applyAction(state,{decisionId:d.id,version:d.version,seat:d.seat,action:choosePeilian(observation(state,d.seat),'',{deterministic:true})});
    }
    const actor=state.pending.seat,other=(actor+1)%4,altered=structuredClone(state);
    [altered.hands[other][0],altered.kitty[0]]=[altered.kitty[0],altered.hands[other][0]];
    altered.seed+=101;altered.quiz={answer:'private'};
    const encode=state=>{const view=observation(state,actor),moves=followMoves(view);return buildAdvisorContext(view,moves,toolFor(view.phase,moves));};
    assert.deepEqual(encode(state),encode(altered));
  }
});

test('bidding and redeal choices do not receive a reference policy suggestion', () => {
  for(const phase of ['declare','rebel'])assert.equal(buildAdvisorContext({phase},null,toolFor(phase)),null);
});

test('coached requests label advice and audit agreement without silently replacing a different model action', async () => {
  const state=cardPlayFixture(503),view=observation(state,state.pending.seat);
  const env={QWEN_API_KEY:'fixture-only',QWEN_BASE_URL:'https://example.invalid/v1'},seat={provider:'qwen',model:'fixture'};
  const options={env,contextProfile:'coached'};
  const request=buildRequest(view,seat,options),compact=JSON.parse(request.body.messages[1].content);
  assert.equal(compact.v,7);assert.equal(compact.referenceAdvice.policy,'peilian');
  assert.equal(JSON.stringify(request.body).includes('fixture-only'),false);
  const advice=compact.referenceAdvice.tool;
  const alternate=view.hand.find(card=>!advice.arguments.card_ids.includes(card.id));
  assert.ok(alternate);
  for(const args of [advice.arguments,{card_ids:[alternate.id]}]) {
    const result=await requestAction(view,seat,{...options,fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:advice.name,arguments:JSON.stringify(args)}}]}}]})})});
    assert.equal(result.metering.advisorPolicy,'peilian');
    assert.deepEqual(result.action.cardIds,args.card_ids);
    assert.equal(result.metering.referenceAdviceFollowed,args===advice.arguments);
    assert.equal(result.simulated,false);
  }
});

test('live API seats use their chosen prompt language and ignore legacy advice flags', async () => {
  const state=cardPlayFixture(809),seen=new Set();
  const seats=state.seats.map((seat,index)=>({...seat,kind:'api',provider:'qwen',model:'fixture',referenceAdvice:true,promptLanguage:index%2===0?'zh':'en',endgameAnalysis:index%2===0}));
  const session=new Session({env:{QWEN_API_KEY:'fixture-only',QWEN_BASE_URL:'https://example.invalid/v1'},providerCall:async(view,seat,options)=>{
    seen.add(view.seat);
    assert.equal(options.contextProfile,view.seat%2===0?'expert-search-zh':'expert-facts-en');
    assert.equal(seat.referenceAdvice,undefined);
    return {action:choosePeilian(view,options.decisionId),usage:{input:0,output:0,cached:0,cacheWrite:0},ms:0,simulated:true};
  }});
  session.config=validateConfig({seats},{qwen:true});session.state=state;session.state.seats=session.config.seats;session.schedule=()=>{};
  try{for(let i=0;i<48&&state.pending&&seen.size<4;i++)await session.step();}finally{session.stop();}
  assert.equal(seen.size,4);
  assert.equal(validateConfig({seats:seats.map(({promptLanguage,...seat})=>seat)},{qwen:true}).seats[0].promptLanguage,'zh');
  assert.throws(()=>validateConfig({seats:seats.map(seat=>({...seat,promptLanguage:'fr'}))},{qwen:true}),/提示词语言/);
});
