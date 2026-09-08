import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsage, referenceCost } from '../src/usage.js';
import { buildRequest, requestAction } from '../src/providers.js';
import { createGame, observation } from '../src/game.js';
import { Session } from '../server/session.js';

const env = { QWEN_API_KEY: 'fixture-only', QWEN_BASE_URL: 'https://example.invalid/v1' };
const seats = Array.from({ length: 4 }, (_, i) => ({ name: 'seat' + i, kind: 'api', provider: 'qwen', model: 'qwen3.8-flash' }));
const fixture = () => { const state = createGame({ seed: 3, seats }); return observation(state, state.pending.seat); };
const rawUsage = { prompt_tokens: 700, completion_tokens: 60, total_tokens: 760,
  prompt_tokens_details: { cached_tokens: 450 }, completion_tokens_details: { reasoning_tokens: 20 } };
const data = (args, finish = 'tool_calls') => ({
  id: 'fixture-response', choices: [{ finish_reason: finish, message: { tool_calls: [{ function: { name: 'declare_trump', arguments: args } }] } }],
  usage: rawUsage,
});
const fetchResult = (body, status = 200) => async () => ({ ok: status === 200, status, json: async () => body });

test('unknown usage and unpriced models remain unknown', () => {
  const usage = normalizeUsage('qwen', undefined);
  assert.equal(usage.input, null); assert.equal(usage.output, null);
  assert.equal(referenceCost('qwen3.8-flash', usage), null);
  assert.equal(referenceCost('another-model', normalizeUsage('qwen', rawUsage)), null);
});
test('cached input and reasoning output are subsets, not extra billed totals', () => {
  const usage = normalizeUsage('qwen', rawUsage);
  assert.deepEqual(usage, { input: 700, output: 60, cached: 450, cacheWrite: null, reasoning: 20, total: 760 });
  const quote = referenceCost('qwen3.8-flash', usage);
  assert.ok(Math.abs(quote.amount - 0.0001332) < 1e-12);
  assert.equal(quote.actualCharge, false); assert.equal(quote.tokenPlanCredits, null);
});
test('Qwen 3.8 efficient preset disables thinking and caps the complete output', () => {
  const request = buildRequest(fixture(), seats[0], { env, maxOutput: 192 });
  assert.equal(request.body.enable_thinking, false);
  assert.equal(request.body.max_completion_tokens, 192);
  assert.equal('max_tokens' in request.body, false);
  assert.equal(request.body.parallel_tool_calls, false);
  assert.equal(request.body.preserve_thinking, false);
  assert.equal(request.body.tool_choice.function.name, 'declare_trump');
});
test('malformed tool arguments retain all reported usage and no credentials', async () => {
  await assert.rejects(requestAction(fixture(), seats[0], { env, fetchImpl: fetchResult(data('{invalid')) }), (error) => {
    assert.equal(error.metering.usageKnown, true);
    assert.equal(error.metering.usage.total, 760);
    assert.equal(error.metering.responseId, 'fixture-response');
    assert.ok(error.metering.requestBytes > 0);
    assert.equal(JSON.stringify(error.metering).includes('fixture-only'), false);
    return true;
  });
});
test('truncation retains its metering instead of pretending no tokens were used', async () => {
  await assert.rejects(requestAction(fixture(), seats[0], { env, fetchImpl: fetchResult(data('{}', 'length')) }), (error) => {
    assert.equal(error.metering.finishReason, 'length');
    assert.equal(error.metering.usage.output, 60);
    assert.ok(error.metering.referenceCost.amount > 0);
    return true;
  });
});
test('provider timing headers are not financial costs', async () => {
  const response = await requestAction(fixture(), seats[0], { env, fetchImpl: async () => ({
    ok: true, status: 200,
    headers: new Headers({ 'req-cost-time': '919', 'x-billing-credits': '0.2' }),
    json: async () => data('{"choice":"pass"}'),
  }) });
  assert.deepEqual(response.metering.billingHeaders, { 'x-billing-credits': 0.2 });
  assert.equal(response.metering.referenceCost.tokenPlanCredits, null);
});
test('HTTP errors can carry usage, and missing usage is explicitly unknown', async () => {
  await assert.rejects(requestAction(fixture(), seats[0], { env, fetchImpl: fetchResult({ usage: rawUsage }, 429) }), (error) => {
    assert.equal(error.metering.httpStatus, 429); assert.equal(error.metering.usageKnown, true); return true;
  });
  await assert.rejects(requestAction(fixture(), seats[0], { env, fetchImpl: fetchResult({}, 401) }), (error) => {
    assert.equal(error.metering.usageKnown, false); assert.equal(error.metering.referenceCost, null); return true;
  });
});
test('authentication failures are not blindly retried', async () => {
  let calls = 0;
  const session = new Session({ env, providerCall: (view, seat, options) => requestAction(view, seat, {
    ...options, fetchImpl: async () => { calls++; return { ok: false, status: 401, json: async () => ({}) }; },
  }) });
  session.start({ seats, dealing: 'ordered' }); clearTimeout(session.timer);
  await session.step(); session.stop();
  assert.equal(calls, 1); assert.equal(session.stats.realRequests, 1);
  assert.equal(session.stats.usageUnknown, 1);
});
test('invalid game proposals count tokens once per attempt and yield one audit entry each', async () => {
  const session = new Session({ env, providerCall: (view, seat, options) => requestAction(view, seat, {
    ...options, fetchImpl: fetchResult(data('{"choice":"not-a-choice"}')),
  }) });
  session.start({ seats, dealing: 'ordered' }); clearTimeout(session.timer);
  await session.step(); session.stop();
  assert.equal(session.stats.realRequests, 2);
  assert.equal(session.stats.input, 1400); assert.equal(session.stats.output, 120);
  assert.equal(session.stats.reasoning, 40);
  assert.equal(session.stats.usageUnknown, 0);
  assert.equal(session.stats.referencePricedRequests, 2);
  assert.equal(session.logs.filter((entry) => entry.type === 'request').length, 2);
  assert.equal(session.stats.fallbacks, 1);
});
