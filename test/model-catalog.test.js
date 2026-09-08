import test from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_PLAN_MODELS, tokenPlanModel, assertTokenPlanModel } from '../src/model-catalog.js';
import { buildRequest, requestAction } from '../src/providers.js';
import { createGame, observation, applyAction } from '../src/game.js';
import { referenceCost } from '../src/usage.js';
import { Session } from '../server/session.js';
const env = { QWEN_API_KEY: 'fixture-only', QWEN_BASE_URL: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1' };
const state = createGame({ id: 'catalog-fixture', seed: 21, seats: Array.from({ length: 4 }, () => ({ kind: 'peilian' })) });
const view = observation(state, state.pending.seat);

test('the Token Plan picker only includes the nine text/tool models in the verified plan list', () => {
  assert.equal(TOKEN_PLAN_MODELS.length, 9);
  assert.equal(new Set(TOKEN_PLAN_MODELS.map(m => m.id)).size, 9);
  for (const model of TOKEN_PLAN_MODELS) {
    assert.equal(model.text && model.toolCalling && model.nonThinking, true);
    assert.ok(model.input > 0 && model.output > 0);
  }
  for (const id of ['qwen-image-3.0-pro', 'qwen-audio-3.0-realtime-plus', 'wan2.7-image', 'happyhorse-1.1-t2v', 'qwen3.7-flash', 'glm-5.2-fast-preview']) {
    assert.equal(tokenPlanModel(id), null);
    assert.throws(() => assertTokenPlanModel(id, env.QWEN_BASE_URL));
  }
});
test('every listed model has a bounded non-thinking chat/tool request and native action parsing', async () => {
  for (const model of TOKEN_PLAN_MODELS) {
    const seat = { provider: 'qwen', model: model.id };
    const request = buildRequest(view, seat, { env, maxOutput: 192 });
    assert.equal(request.body.model, model.id);
    assert.equal(request.body.enable_thinking, false);
    assert.equal(request.body.max_completion_tokens, 192);
    assert.equal(request.body.max_tokens, undefined);
    assert.equal(request.body.parallel_tool_calls, false);
    assert.equal(request.body.stream, false);
    assert.equal(request.body.tools.length, 1);
    assert.equal(JSON.stringify(request.body).includes('fixture-only'), false);
    if (model.family === 'GLM') assert.equal(request.body.tool_stream, true);
    const response = await requestAction(view, seat, { env, fetchImpl: async () => ({ ok: true, json: async () => ({
      model: model.id, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'declare_trump', arguments: '{"choice":"pass"}' } }] } }],
      usage: { prompt_tokens: 1500, completion_tokens: 20 },
    }) }) });
    assert.equal(response.metering.resolvedModel, model.id);
    assert.ok(response.metering.referenceCost.amount > 0);
    applyAction(state, { decisionId: state.pending.id, version: state.version, seat: state.pending.seat, action: response.action });
  }
});
test('unsupported Token Plan models are rejected before starting a table or making a request', async () => {
  const session = new Session({ env });
  const seats = Array.from({ length: 4 }, () => ({ kind: 'api', provider: 'qwen', model: 'qwen-image-3.0-pro' }));
  assert.throws(() => session.start({ seats }));
  assert.equal(session.state, null);
  let calls = 0;
  await assert.rejects(requestAction(view, seats[0], { env, fetchImpl: () => { calls++; } }));
  assert.equal(calls, 0);
});
test('model prices stay references, variable prices use the busy rate, and unknown quotes remain unknown', () => {
  assert.equal(referenceCost('deepseek-v4-pro-0813', { input: 1000, output: 100 }).amount, 0.001716);
  for (const model of TOKEN_PLAN_MODELS) {
    const quote = referenceCost(model.id, { input: 1000, output: 100 });
    assert.equal(quote.actualCharge, false); assert.equal(quote.tokenPlanCredits, null);
    assert.equal(referenceCost(model.id, { input: 130000, output: 100 }), null);
  }
  assert.equal(referenceCost('glm-5.2', {}), null);
  assert.equal(referenceCost('glm-5.2', { input: -1, output: 10 }), null);
});
