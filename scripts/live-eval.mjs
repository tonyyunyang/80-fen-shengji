import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createGame, applyAction, observation } from '../src/game.js';
import { choosePeilian } from '../src/peilian.js';
import { requestAction, buildRequest, followMoves } from '../src/providers.js';
import { MAX_DECISION_MS } from '../src/player-settings.js';

try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const live = process.argv.includes('--live');
const model = process.env.EVAL_MODEL || 'qwen3.8-flash';
const maxOutput = 192;
const selected = { kind: 'api', provider: 'qwen', model };
const base = process.env.QWEN_BASE_URL || '';
if (live && (!process.env.QWEN_API_KEY || !base)) throw new Error('Set a matching QWEN_API_KEY and QWEN_BASE_URL in .env first.');
const testEnv = live ? process.env : { QWEN_API_KEY: 'dry-run-placeholder', QWEN_BASE_URL: 'https://example.invalid/v1' };
const snapshots = new Map();
const recheckAt = process.argv.indexOf('--recheck');
const recheckPath = recheckAt >= 0 ? process.argv[recheckAt + 1] : null;
if (recheckPath) {
  const previous = JSON.parse(await readFile(recheckPath, 'utf8'));
  const wanted = new Set(previous.requests.filter((entry) => entry.outcome === 'error').map((entry) => entry.decisionId));
  let state = createGame({ id: previous.finalState.id, seed: previous.seed, seats: previous.finalState.seats, rules: previous.finalState.rules });
  for (const event of previous.finalState.events.filter((event) => event.type === 'decision_applied')) {
    if (wanted.has(state.pending.id)) snapshots.set('regression-' + state.pending.id.split(':').at(-1), structuredClone(state));
    state = applyAction(state, { decisionId: state.pending.id, version: state.version, seat: state.pending.seat, action: event.requested, source: event.source });
  }
} else {
  const seats = Array.from({ length: 4 }, () => ({ kind: 'peilian' }));
  let game = createGame({ id: 'eval-fixtures-v1-seed21', seed: 21, seats });
  while (game.pending && snapshots.size < 3) {
    const decision = game.pending;
    if (['declare', 'bury', 'follow'].includes(decision.phase) && !snapshots.has(decision.phase)) snapshots.set(decision.phase, structuredClone(game));
    const view = observation(game, decision.seat);
    game = applyAction(game, { decisionId: decision.id, version: decision.version, seat: decision.seat, action: choosePeilian(view, decision.id) });
  }
}
const report = {
  version: 1, runId: randomUUID(), mode: live ? (recheckPath ? 'live-recheck' : 'live') : 'dry-run',
  model, startedAt: new Date().toISOString(),
  requestLimit: 3, maxCompletionTokensPerRequest: maxOutput, timeoutMs: MAX_DECISION_MS,
  thinking: false, billingNote: 'Reference estimates are not an invoice or Token Plan Credit deductions.',
  attempts: [], sentRequests: 0,
};
const directory = 'data/evaluations';
await mkdir(directory, { recursive: true });
const path = directory + '/' + report.runId + '.json';
const save = () => writeFile(path, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
await save();
for (const [fixture, state] of snapshots) {
  if (report.sentRequests >= report.requestLimit) break;
  const decision = state.pending;
  const view = observation(state, decision.seat);
  const phase = decision.phase;
  const moves = followMoves(view);
  if (recheckPath && moves?.length === 1) {
    const action = { type: 'play', cardIds: moves[0] };
    applyAction(state, { decisionId: decision.id, version: decision.version, seat: decision.seat, action });
    report.attempts.push({ phase, fixture, status: 'forced', sent: false, action });
    continue;
  }
  const request = buildRequest(view, selected, { env: testEnv, maxOutput });
  const requestBytes = Buffer.byteLength(JSON.stringify(request.body));
  if (requestBytes > 24000) throw new Error('Request byte limit exceeded');
  if (!live) {
    report.attempts.push({ phase, fixture, requestBytes, sent: false, observedTokens: null });
    continue;
  }
  report.sentRequests++;
  const entry = { phase, fixture, requestBytes, sent: true, status: 'pending', metering: null };
  report.attempts.push(entry);
  await save(); // Persist the attempt before dispatch, including uncertain outcomes.
  try {
    const response = await requestAction(view, selected, { env: testEnv, maxOutput, signal: AbortSignal.timeout(MAX_DECISION_MS) });
    entry.metering = response.metering;
    applyAction(state, { decisionId: decision.id, version: decision.version, seat: decision.seat, action: response.action });
    entry.action = response.action; entry.status = 'valid';
  } catch (error) {
    entry.metering ||= error.metering || null;
    entry.error = error.message; entry.status = 'failed';
    break; // Initial smoke tests do not spend more on retries or a broken integration.
  } finally { await save(); }
}
report.finishedAt = new Date().toISOString();
report.summary = {
  sentRequests: report.sentRequests,
  valid: report.attempts.filter((entry) => entry.status === 'valid').length,
  failed: report.attempts.filter((entry) => entry.status === 'failed').length,
  knownInputTokens: report.attempts.reduce((sum, entry) => sum + (entry.metering?.usage?.input ?? 0), 0),
  knownOutputTokens: report.attempts.reduce((sum, entry) => sum + (entry.metering?.usage?.output ?? 0), 0),
  unknownUsageRequests: report.attempts.filter((entry) => entry.sent && !entry.metering?.usageKnown).length,
  pricedRequests: report.attempts.filter((entry) => entry.sent && entry.metering?.referenceCost).length,
  referenceCostComplete: report.attempts.every((entry) => !entry.sent || !!entry.metering?.referenceCost),
  knownReferenceUsdSubtotal: report.attempts.reduce((sum, entry) => sum + (entry.metering?.referenceCost?.amount ?? 0), 0),
  actualTokenPlanCredits: null,
};
await save();
console.log(JSON.stringify({ report: path, mode: report.mode, model, ...report.summary, cases: report.attempts.map(({ phase, requestBytes, status, sent }) => ({ phase, requestBytes, status, sent })) }, null, 2));
