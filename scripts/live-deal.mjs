import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Session, validateConfig } from '../server/session.js';
import { createGame, assertConservation, isBidding } from '../src/game.js';
import { requestAction, buildRequest } from '../src/providers.js';
import { MAX_DECISION_MS } from '../src/player-settings.js';

try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!process.argv.includes('--live')) {
  console.log('Live calls require --live. This evaluator runs exactly one deal with one model seat, at most 40 requests.');
  process.exit(0);
}
if (!process.env.QWEN_API_KEY || !process.env.QWEN_BASE_URL) throw new Error('Configure the matching Qwen credential and endpoint first.');
const resumeAt = process.argv.indexOf('--resume');
const previous = resumeAt >= 0 ? JSON.parse(await readFile(process.argv[resumeAt + 1], 'utf8')) : null;
const report = {
  version: 1, runId: randomUUID(), mode: 'live-deal', model: 'qwen3.8-flash',
  seed: previous?.seed ?? 20260908, parentRunId: previous?.runId ?? null, contextVersion: 2, startedAt: new Date().toISOString(), apiSeat: 0,
  requestLimit: 40, maxCompletionTokensPerRequest: 192, timeoutMs: MAX_DECISION_MS,
  maxWallTimeMs: 300000, maxReportedTokens: 100000, requests: [], events: [],
};
await mkdir('data/evaluations', { recursive: true });
const path = 'data/evaluations/' + report.runId + '.json';
let writes = Promise.resolve();
const save = () => {
  const body = JSON.stringify(report, null, 2) + '\n';
  writes = writes.then(() => writeFile(path, body, { mode: 0o600 }));
  return writes;
};
let session;
session = new Session({
  providerCall: async (view, seat, options) => {
    const decision = { id: options.decisionId || session.state.pending?.id, phase: view.phase };
    const requestBytes = Buffer.byteLength(JSON.stringify(buildRequest(view, seat, options).body));
    if (requestBytes > 24000) throw new Error('Request byte guard exceeded');
    const attempt = report.requests.filter((entry) => entry.decisionId === decision.id).length;
    const entry = {
      index: report.requests.length + 1, decisionId: decision.id, phase: decision.phase, attempt,
      startedAt: new Date().toISOString(), requestBytes, status: 'pending', metering: null,
    };
    report.requests.push(entry);
    await save();
    try {
      const response = await requestAction(view, seat, options);
      entry.metering = response.metering; entry.action = response.action; entry.status = 'returned';
      return response;
    } catch (error) {
      entry.metering = error.metering || null; entry.error = error.message; entry.status = 'failed';
      throw error;
    } finally {
      entry.finishedAt = new Date().toISOString();
      await save();
      console.log(JSON.stringify({ request: entry.index, phase: entry.phase, input: entry.metering?.usage.input,
        output: entry.metering?.usage.output, ms: Math.round(entry.metering?.ms || 0), status: entry.status }));
    }
  },
  audit: (entry) => {
    if (entry.type === 'request') {
      const request = report.requests.findLast((request) => request.decisionId === entry.decisionId && request.attempt === entry.attempt);
      if (request) {
        request.outcome = entry.outcome; request.error = entry.error;
        request.status = entry.outcome === 'valid' ? 'valid' : entry.outcome === 'superseded' ? 'superseded' : 'failed';
      }
    } else report.events.push(entry);
  },
});
session.config = validateConfig({
  seats: [ { name: 'Qwen Flash', kind: 'api', provider: 'qwen', model: report.model },
    ...['东家', '北家', '西家'].map((name) => ({ name, kind: 'peilian' })) ],
  limits: { maxRequests: report.requestLimit, maxOutput: 192, timeoutMs: report.timeoutMs }, speed: 100,
});
session.state = previous ? structuredClone(previous.finalState) : createGame({ id: report.runId, seed: report.seed, ...session.config });
if (previous?.dealClock) session.bidding.restore(previous.dealClock);
report.gameId = session.state.id;
report.dealing = session.state.dealing || 'ordered';
report.startingTrick = session.state.tricks.length;
await save();
const started = performance.now();
let steps = 0, lastVersion = -1;
while ((session.state.pending || isBidding(session.state)) && !session.paused) {
  if (performance.now() - started > report.maxWallTimeMs) { report.stopReason = 'wall_time_guard'; break; }
  if (session.stats.input + session.stats.output >= report.maxReportedTokens) { report.stopReason = 'reported_token_guard'; break; }
  if (session.stats.errors >= 3) { report.stopReason = 'error_guard'; break; }
  if (session.state.version !== lastVersion) { steps++; lastVersion = session.state.version; }
  if (steps > 250) { report.stopReason = 'engine_step_guard'; break; }
  if (isBidding(session.state)) { session.schedule(); await new Promise(resolve => setTimeout(resolve, 100)); }
  else if (session.busy) await new Promise(resolve => setTimeout(resolve, 50));
  else { await session.step(); clearTimeout(session.timer); }
  assertConservation(session.state);
  report.progress = { steps, phase: session.state.phase, tricks: session.state.tricks.length,
    remainingCards: session.state.hands.map((hand) => hand.length), requests: report.requests.length };
  await save();
}
session.stop();
report.dealClock = session.bidding.checkpoint();
report.finishedAt = new Date().toISOString();
report.wallMs = performance.now() - started;
report.stopReason ||= session.state.phase === 'round_over' || session.state.phase === 'match_over' ? 'deal_complete' : session.paused ? 'runner_paused' : 'stopped';
const latencies = report.requests.map((entry) => entry.metering?.ms).filter(Number.isFinite).sort((a, b) => a - b);
const percentile = (p) => latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] : null;
report.summary = {
  completed: report.stopReason === 'deal_complete', requests: report.requests.length,
  validResponses: report.requests.filter((entry) => entry.outcome === 'valid').length,
  supersededResponses: report.requests.filter((entry) => entry.outcome === 'superseded').length,
  errors: session.stats.errors, retries: report.requests.filter((entry) => entry.attempt > 0).length,
  fallbacks: session.stats.fallbacks, forcedActions: session.stats.forced,
  forcedPasses: session.state.forcedPasses, inputTokens: session.stats.input,
  outputTokens: session.stats.output, cachedInputTokens: session.stats.cached,
  unknownUsageRequests: session.stats.usageUnknown, p50Ms: percentile(.5), p95Ms: percentile(.95),
  meanMs: latencies.length ? latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length : null,
  maxMs: latencies.at(-1) ?? null,
  knownReferenceUsdSubtotal: session.stats.referenceCostUsd,
  referenceCostComplete: session.stats.usageUnknown === 0 && session.stats.referencePricedRequests === report.requests.length,
  actualTokenPlanCredits: null, tricks: session.state.tricks.length, dealer: session.state.dealer, score: session.state.score,
};
report.finalState = session.state; // Private reproduction artifact; never included in a provider request.
await save();
console.log(JSON.stringify({ report: path, model: report.model, stopReason: report.stopReason, ...report.summary }, null, 2));
