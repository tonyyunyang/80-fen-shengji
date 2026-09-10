import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, observation, safeAction } from '../src/game.js';
import { buildRequest, requestAction, parseToolCall, compactObservation } from '../src/providers.js';
import { Session, validateConfig } from '../server/session.js';
const seats = Array.from({ length: 4 }, () => ({ kind: 'api', provider: 'mock', name: 'API' }));
const config = { seats, dealing: 'ordered', limits: { maxRequests: 1 }, speed: 2000 };
const fixture = () => { const s = createGame({ seed: 1, seats }); return observation(s, s.pending.seat); };
const env = { OPENAI_API_KEY: 'fixture-only', ANTHROPIC_API_KEY: 'fixture-only', QWEN_API_KEY: 'fixture-only', QWEN_BASE_URL: 'https://example.invalid/v1' };
test('provider request bodies use the native schemas and contain no hidden state', () => {
  const view = fixture();
  for (const provider of ['openai', 'claude', 'qwen']) {
    const request = buildRequest(view, { provider, model: 'fixture-model' }, { env });
    assert.equal(request.body.model, 'fixture-model');
    assert.equal(JSON.stringify(request.body).includes('fixture-only'), false);
    assert.equal(JSON.stringify(request.body).includes('"seed"'), false);
  }
  assert.equal(buildRequest(view, { provider: 'openai', model: 'fixture' }, { env }).body.parallel_tool_calls, false);
  assert.equal(buildRequest(view, { provider: 'claude', model: 'fixture' }, { env }).body.tool_choice.disable_parallel_tool_use, true);
});
test('OpenAI, Claude and Qwen response fixtures normalize to the same action', async () => {
  const view = fixture();
  const samples = {
    openai: { output: [{ type: 'function_call', name: 'declare_trump', arguments: '{"choice":"pass"}' }], usage: { input_tokens: 12, output_tokens: 3 } },
    claude: { content: [{ type: 'tool_use', name: 'declare_trump', input: { choice: 'pass' } }], usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 5 } },
    qwen: { choices: [{ message: { tool_calls: [{ function: { name: 'declare_trump', arguments: '{"choice":"pass"}' } }] } }], usage: { prompt_tokens: 12, completion_tokens: 3 } },
  };
  for (const provider of Object.keys(samples)) {
    const result = await requestAction(view, { provider, model: 'fixture' }, { env, fetchImpl: async () => ({ ok: true, json: async () => samples[provider] }) });
    assert.deepEqual(result.action, { type: 'declare', choice: 'pass' });
    assert.equal(result.usage.output, 3);
    if (provider === 'claude') assert.equal(result.usage.input, 17);
  }
});
test('extra tools, malformed args, missing tools and truncation are rejected', async () => {
  assert.throws(() => parseToolCall('play_cards', { card_ids: [1] }, 'declare'));
  assert.throws(() => parseToolCall('declare_trump', { choice: 'pass', debug: true }, 'declare'));
  const call = { type: 'function_call', name: 'declare_trump', arguments: '{"choice":"pass"}' };
  for (const data of [{ output: [] }, { output: [call, call] }, { status: 'incomplete', output: [call] }]) {
    await assert.rejects(requestAction(fixture(), { provider: 'openai', model: 'fixture' }, { env, fetchImpl: async () => ({ ok: true, json: async () => data }) }));
  }
});
test('mock mode traverses the tool parser and never calls the network', async () => {
  const result = await requestAction(fixture(), { provider: 'mock' }, { fetchImpl: () => { throw Error('Unexpected network'); } });
  assert.equal(result.simulated, true); assert.equal(result.usage.input, 0);
  assert.deepEqual(result.action, { type: 'declare', choice: 'pass' });
});
test('a changed partial hand remains present even if declaration options are unchanged', () => {
  const a = fixture(), b = structuredClone(a);
  b.hand.push({ id: 35, suit: 'D', rank: 11 });
  assert.notDeepEqual(compactObservation(a).hand, compactObservation(b).hand);
});
test('four seat validation rejects invalid counts and unavailable live providers', () => {
  assert.throws(() => validateConfig({ seats: seats.slice(0, 3) }));
  assert.throws(() => validateConfig({ seats: seats.map((s) => ({ ...s, provider: 'openai', model: 'x' })) }, { mock: true }));
  assert.equal(validateConfig(config).seats.length, 4);
});
test('late model reply cannot act on a newly started game or charge its token stats', async () => {
  let resolve;
  const session = new Session({ providerCall: (view) => new Promise((r) => { resolve = () => r({ action: safeAction(view), usage: { input: 10, output: 2, cached: 0, cacheWrite: 0 }, ms: 1, simulated: true }); }) });
  session.start(config); clearTimeout(session.timer);
  const running = session.step();
  const previousId = session.state.id;
  session.start(config); clearTimeout(session.timer);
  const snapshot = structuredClone(session.state);
  resolve(); await running;
  assert.notEqual(session.state.id, previousId);
  assert.deepEqual(session.state, snapshot);
  assert.equal(session.stats.input, 0);
  session.stop();
});
test('bad API actions get one retry and a visible fallback', async () => {
  let calls = 0;
  const session = new Session({ providerCall: async () => { calls++; throw new Error('fixture failure'); } });
  session.start(config); clearTimeout(session.timer);
  await session.step(); session.stop();
  assert.equal(calls, 2); assert.equal(session.stats.fallbacks, 1);
  assert.equal(session.state.lastAction.source, 'fallback');
});
test('real request count limit uses peilian without another request', async () => {
  let calls = 0;
  const session = new Session({ env, providerCall: async (view) => { calls++; return { action: safeAction(view), usage: { input: 1, output: 1, cached: 0, cacheWrite: 0 }, ms: 1, simulated: false }; } });
  session.start({ ...config, seats: seats.map((s) => ({ ...s, provider: 'openai', model: 'fixture' })) }); clearTimeout(session.timer);
  await session.step(); clearTimeout(session.timer);
  await session.step(); session.stop();
  assert.equal(calls, 1); assert.equal(session.paused, false);
  assert.equal(session.state.lastAction.source, 'fallback');
  assert.equal(session.logs.findLast((entry) => entry.fallback).policy, 'peilian');
  assert.equal(session.stats.realRequests, 1);
});


test('one human, one 陪练 and two simulated API seats complete a deal together', async () => {
  const session = new Session();
  session.start({ dealing: 'ordered', seats: [
    { kind: 'human', name: '你' }, { kind: 'api', provider: 'mock', name: '东' },
    { kind: 'peilian', name: '北' }, { kind: 'api', provider: 'mock', name: '西' },
  ] });
  clearTimeout(session.timer);
  let decisions = 0;
  while (session.state.pending && decisions++ < 250) {
    if (session.state.seats[session.state.pending.seat].kind === 'human') {
      const d = session.state.pending;
      session.human({ decisionId: d.id, seat: d.seat, version: d.version, action: safeAction(observation(session.state, d.seat)) });
    } else await session.step();
    clearTimeout(session.timer);
  }
  session.stop();
  assert.equal(session.state.phase, 'round_over');
  assert.ok(session.stats.simulated > 0); assert.ok(session.stats.peilian > 0);
  assert.equal(session.stats.realRequests, 0); assert.equal(session.stats.fallbacks, 0);
});

test('resuming a table without credentials uses peilian without a network attempt', async () => {
  let checkpoint;
  const old = new Session({ env, persist: (data) => { checkpoint = structuredClone(data); } });
  old.start({ ...config, seats: seats.map((seat) => ({ ...seat, provider: 'openai', model: 'fixture' })) }); old.stop();
  let calls = 0;
  const restored = new Session({ env: {}, providerCall: async () => { calls++; throw new Error('Unexpected request'); } });
  restored.restore(checkpoint); restored.pause(false); clearTimeout(restored.timer);
  await restored.step(); restored.stop();
  assert.equal(calls, 0); assert.equal(restored.stats.realRequests, 0); assert.equal(restored.paused, false);
  assert.equal(restored.state.lastAction.source, 'fallback');
});

test('Messages connections accept a base URL with or without the v1 suffix',()=>{
  for(const base of ['https://example.com','https://example.com/v1','https://example.com/v1/']){
    const request=buildRequest(fixture(),{provider:'claude',model:'fixture-model'},{env:{...env,ANTHROPIC_BASE_URL:base}});
    assert.equal(request.url,'https://example.com/v1/messages');
  }
});

test('explicit bounded reasoning settings reserve output space and stay out of default requests', () => {
  const seat = { provider: 'qwen', model: 'qwen3.8-flash' }, view = fixture();
  assert.equal(buildRequest(view, seat, { env }).body.thinking_budget, undefined);
  const body = buildRequest(view, seat, { env, thinking: true, thinkingBudget: 256, maxOutput: 1536 }).body;
  assert.equal(body.enable_thinking, true); assert.equal(body.thinking_budget, 256);
  assert.equal(body.tool_choice, 'auto');
  for (const thinkingBudget of [-1, 1.5, 5000, '256']) {
    assert.throws(() => buildRequest(view, seat, { env, thinking: true, thinkingBudget }), /Thinking budget/);
  }
  assert.throws(() => buildRequest(view, seat, { env, thinking: true, thinkingBudget: 256, reasoningEffort: 'low' }), /cannot be combined/);
  const custom = buildRequest(view, { provider: 'qwen', model: 'k3-256k' }, { env, reasoningEffort: 'low' }).body;
  assert.equal(custom.reasoning_effort, 'low');
  assert.equal(custom.enable_thinking, undefined, 'do not disable an unknown model\'s native reasoning');
  assert.throws(() => buildRequest(view, seat, { env, reasoningEffort: 'invented' }), /Reasoning effort/);
});

test('Kimi Code fast mode is explicit, bounded and only applies to the documented host and model IDs',()=>{
 const view=fixture(),seat={provider:'qwen',model:'kimi-for-coding'};
 const request=buildRequest(view,seat,{env:{...env,QWEN_BASE_URL:'https://api.kimi.com/coding/v1'},maxOutput:512});
 assert.equal(request.body.reasoning_effort,'none');assert.equal(request.body.max_tokens,512);
 assert.equal(request.body.tools,undefined);
 assert.equal(request.body.tool_choice,undefined);
 assert.equal(request.body.response_format.type,'json_object');
 assert.equal(request.actionFormat,'json_action');
 for(const url of ['https://other.example/coding/v1','https://api.kimi.com/other/v1']){
  assert.equal(buildRequest(view,seat,{env:{...env,QWEN_BASE_URL:url}}).body.reasoning_effort,undefined);
 }
 assert.equal(buildRequest(view,{...seat,model:'unknown'},{env:{...env,QWEN_BASE_URL:'https://api.kimi.com/coding/v1'}}).body.reasoning_effort,undefined);
});


test('Kimi JSON actions remain strict, native-tool provenance stays accurate, and unrelated services are not relaxed',async()=>{
 const view=fixture(),seat={provider:'qwen',model:'kimi-for-coding'},options={env:{...env,QWEN_BASE_URL:'https://api.kimi.com/coding/v1'},contextProfile:'expert-zh'};
 const response=content=>async()=>({ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:50,completion_tokens:8}})});
 const good=JSON.stringify({choice:'pass'}),result=await requestAction(view,seat,{...options,fetchImpl:response(good)});
 assert.deepEqual(result.action,{type:'declare',choice:'pass'});assert.equal(result.metering.actionFormat,'json_action');
 assert.equal(result.metering.toolCallCount,0);assert.equal(result.metering.actionCount,1);assert.equal(result.simulated,false);
 for(const content of ['Here is the action: '+good,'```json\n'+good+'\n```','[ '+good+' ]','{"choice":"pass","explanation":"extra"}','null']){
  await assert.rejects(requestAction(view,seat,{...options,fetchImpl:response(content)}));
 }
 await assert.rejects(requestAction(view,seat,{env,fetchImpl:response(good)}),/恰好一个工具调用/);
});
