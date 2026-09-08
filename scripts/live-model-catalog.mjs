import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { TOKEN_PLAN_MODELS } from '../src/model-catalog.js';
import { MAX_DECISION_MS } from '../src/player-settings.js';
import { createGame, observation, applyAction } from '../src/game.js';
import { requestAction } from '../src/providers.js';

const modelAt = process.argv.indexOf('--model');
const selectedModel = modelAt >= 0 ? process.argv[modelAt + 1] : null;
const outputAt = process.argv.indexOf('--max-output');
const maxOutput = Math.floor(Math.max(128, Math.min(512, Number(outputAt >= 0 ? process.argv[outputAt + 1] : 192) || 192)));
const models = TOKEN_PLAN_MODELS.filter((model) => selectedModel ? model.id === selectedModel : !model.liveVerified).slice(0, 8);
if (!models.length) throw new Error('No catalog model matched the selection');
if (!process.argv.includes('--live')) {
  console.log(JSON.stringify({ mode: 'dry-run', sentRequests: 0, models: models.map(model => model.id), requestLimit: 8 }));
  process.exit(0);
}
process.loadEnvFile('.env');
const state = createGame({ id: 'catalog-probe-seed21', seed: 21, seats: Array.from({ length: 4 }, () => ({ kind: 'peilian' })) });
const view = observation(state, state.pending.seat);
const report = { version: 1, runId: randomUUID(), mode: 'live-model-catalog', startedAt: new Date().toISOString(),
  requestLimit: 8, maxOutput, timeoutMs: MAX_DECISION_MS, attempts: [] };
await mkdir('data/evaluations', { recursive: true });
const path = 'data/evaluations/' + report.runId + '.json';
const save = () => writeFile(path, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
for (const model of models) {
  const entry = { model: model.id, phase: view.phase, sent: true, status: 'pending', metering: null };
  report.attempts.push(entry); await save();
  try {
    const response = await requestAction(view, { provider: 'qwen', model: model.id }, { maxOutput, signal: AbortSignal.timeout(MAX_DECISION_MS) });
    entry.metering = response.metering;
    applyAction(state, { decisionId: state.pending.id, version: state.version, seat: state.pending.seat, action: response.action });
    entry.action = response.action; entry.status = 'valid';
  } catch (error) {
    entry.metering ||= error.metering || null; entry.status = 'failed'; entry.error = error.message;
  }
  await save();
  console.log(JSON.stringify({ model: model.id, status: entry.status, input: entry.metering?.usage.input, output: entry.metering?.usage.output,
    ms: Math.round(entry.metering?.ms || 0), error: entry.error }));
  if ([401, 403].includes(entry.metering?.httpStatus)) break;
}
report.finishedAt = new Date().toISOString();
report.summary = {
  requests: report.attempts.length, valid: report.attempts.filter(entry => entry.status === 'valid').length,
  inputTokens: report.attempts.reduce((n, entry) => n + (entry.metering?.usage.input || 0), 0),
  outputTokens: report.attempts.reduce((n, entry) => n + (entry.metering?.usage.output || 0), 0),
  cachedInputTokens: report.attempts.reduce((n, entry) => n + (entry.metering?.usage.cached || 0), 0),
  unknownUsageRequests: report.attempts.filter(entry => !entry.metering?.usageKnown).length,
  knownReferenceUsdSubtotal: report.attempts.reduce((n, entry) => n + (entry.metering?.referenceCost?.amount || 0), 0),
  actualTokenPlanCredits: null,
};
await save();
console.log(JSON.stringify({ report: path, ...report.summary }, null, 2));
