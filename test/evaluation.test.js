import test from 'node:test';
import assert from 'node:assert/strict';
import { runEvaluation, summarizePairs } from '../scripts/paired-eval.mjs';

test('offline paired harness covers every seat and repeats equal policies on identical hands', async () => {
  const report = await runEvaluation({ call: () => { throw new Error('Offline must not call provider'); } });
  assert.equal(report.requests.length, 0);
  assert.equal(report.games.length, 4);
  assert.deepEqual(report.contextProfiles, ['notebook', 'tactical']);
  assert.ok(report.summary.comparisons.every(row => row.baseline === 'notebook' && row.candidate === 'tactical'));
  assert.ok(report.games.every(game => game.completed && !game.sources.fallback && !game.sources.api));
  assert.deepEqual(report.summary.comparisons.map(row => row.marginChange), [0]);
  assert.ok(report.summary.pairs.every(pair => pair.simulated));
});
test('evaluation rejects ambiguous context comparisons before running', async () => {
  for (const contextProfiles of [['tactical', 'tactical'], ['unknown', 'tactical'], [], ['baseline','tactical','strategic']]) {
    await assert.rejects(runEvaluation({ contextProfiles }), /one or two distinct supported/);
  }
});
test('one profile plays a complete swapped-team pair against Peilian without claiming an A/B comparison', async () => {
  const report=await runEvaluation({contextProfiles:['strategic']});
  assert.equal(report.designKind,'against-peilian');
  assert.equal(report.games.length,2);
  assert.equal(report.summary.pairs.length,1);
  assert.equal(report.summary.comparisons.length,0);
  assert.ok(report.games.every(game=>game.completed));
});
test('incomplete swaps do not become paired results and assisted games stay labeled', () => {
  const game = { seed: 1, profile: 'notebook', team: 0, completed: true, margin: 20, won: true, sources: { fallback: 1 } };
  assert.equal(summarizePairs([game]).pairs.length, 0);
  assert.equal(summarizePairs([game, { ...game, team: 1 }]).pairs[0].assisted, true);
});
test('hard pilot budget is shared across games and repairs', async () => {
  let calls = 0;
  const report = await runEvaluation({ live: true, env: { QWEN_API_KEY: 'fixture-only', QWEN_BASE_URL: 'https://example.invalid/v1' }, maxRequests: 3,
    call: async () => { calls++; throw new Error('Fixture failure'); } });
  assert.equal(calls, 3); assert.equal(report.requests.length, 3);
  assert.equal(report.stopReason, 'request_guard');
  assert.equal(report.summary.pairs.length, 0);
});
test('wall cutoff rejects a provider that never cooperates with cancellation', async () => {
  const start = Date.now();
  const report = await runEvaluation({ live: true, env: { QWEN_API_KEY: 'fixture-only', QWEN_BASE_URL: 'https://example.invalid/v1' }, maxMs: 40,
    call: () => new Promise(() => {}) });
  assert.equal(report.stopReason, 'wall_time_guard');
  assert.ok(Date.now() - start < 1000);
  assert.equal(report.summary.pairs.length, 0);
});
test('a late response persists corrected usage without applying its action', async () => {
  let finish, saved;
  const report = await runEvaluation({ live: true, env: { QWEN_API_KEY: 'fixture-only', QWEN_BASE_URL: 'https://example.invalid/v1' }, maxMs: 200,
    call: () => new Promise(resolve => { finish = resolve; }),
    onProgress: async report => { saved = structuredClone(report); } });
  assert.equal(report.requests.length, 1);
  const sources = structuredClone(report.games[0].sources);
  finish({ action: { type: 'play', cardIds: [] }, usage: { input: 11, output: 3, cached: 0, cacheWrite: 0 }, ms: 250 });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(saved.lateUsage[0].applied, false);
  assert.equal(saved.games[0].stats.input, 11);
  assert.equal(saved.games[0].stats.usageUnknown, 0);
  assert.deepEqual(saved.games[0].sources, sources);
  assert.equal(saved.games[0].completed, false);
});
