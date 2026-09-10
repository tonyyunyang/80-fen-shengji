import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGame, observation, applyAction, assertConservation } from '../src/game.js';
import { choosePeilian } from '../src/peilian.js';
import { requestAction, buildRequest, CONTEXT_PROFILES } from '../src/providers.js';
import { DEFAULT_TOKEN_PLAN_MODEL } from '../src/model-catalog.js';
import { Session, validateConfig } from '../server/session.js';

export const HELD_OUT_SEEDS = Object.freeze([20260911, 20260913, 20260917, 20260919, 20260923, 20260929, 20261001, 20261003]);

export function cardPlayFixture(seed) {
  let state = createGame({ id: 'paired-' + seed, seed, dealing: 'ordered',
    seats: Array.from({ length: 4 }, (_, seat) => ({ kind: 'peilian', name: 'Seat ' + seat })) });
  let decisions = 0;
  while (!['lead', 'follow'].includes(state.pending?.phase)) {
    if (++decisions > 400) throw new Error('Fixture did not reach card play');
    const d = state.pending;
    state = applyAction(state, { decisionId: d.id, version: d.version, seat: d.seat,
      action: choosePeilian(observation(state, d.seat), d.id, { deterministic: true }), source: 'peilian' });
  }
  assertConservation(state);
  return state;
}

export function summarizePairs(games, contextProfiles = ['notebook', 'tactical']) {
  const pairs = [];
  for (const profile of [...new Set(games.map(game => game.profile))]) {
    for (const seed of [...new Set(games.map(game => game.seed))]) {
      const both = games.filter(game => game.seed === seed && game.profile === profile && game.completed);
      if (both.length !== 2 || new Set(both.map(game => game.team)).size !== 2) continue;
      pairs.push({ seed, profile, wins: both.filter(game => game.won).length,
        meanMargin: both.reduce((sum, game) => sum + game.margin, 0) / 2,
        assisted: both.some(game => game.sources.fallback > 0), simulated: both.some(game => game.sources.simulated > 0) });
    }
  }
  const comparisons = [];
  for (const seed of [...new Set(pairs.map(pair => pair.seed))]) {
    const baseline = pairs.find(pair => pair.seed === seed && pair.profile === contextProfiles[0]);
    const candidate = pairs.find(pair => pair.seed === seed && pair.profile === contextProfiles[1]);
    if (baseline && candidate) comparisons.push({ seed, baseline: contextProfiles[0], candidate: contextProfiles[1], marginChange: candidate.meanMargin - baseline.meanMargin });
  }
  return { pairs, comparisons, incompleteGames: games.filter(game => !game.completed).length,
    confidenceInterval: null, strengthClaim: 'Not established. This is a small card-play pilot. Bidding/burial are frozen; fallback-assisted and simulated games do not establish model parity. Use multiple held-out seed clusters and full-game live runs before a strength claim.' };
}

export async function runEvaluation({ live = false, env = {}, model = DEFAULT_TOKEN_PLAN_MODEL, seeds = HELD_OUT_SEEDS.slice(0, 1), contextProfiles = ['notebook', 'tactical'], maxRequests = 200,
  maxMs = 30 * 60_000, maxOutput = 512, maxErrors = 6, maxRequestBytes = 48000, thinking = false, thinkingBudget, call = requestAction, onProgress = async () => {} } = {}) {
  if (!Number.isInteger(maxRequests) || maxRequests < 0 || maxRequests > 200 || !Number.isFinite(maxMs) || maxMs <= 0 || maxMs > 30 * 60_000) throw new Error('Pilot limits exceed 200 requests / 30 minutes');
  if (!Number.isInteger(maxRequestBytes) || maxRequestBytes < 8000 || maxRequestBytes > 96000) throw new Error('Pilot request size guard must be between 8000 and 96000 bytes');
  if (!Number.isInteger(maxErrors) || maxErrors < 1 || maxErrors > 30) throw new Error('Pilot error guard must be between 1 and 30');
  if (!Number.isInteger(maxOutput) || maxOutput < 128 || maxOutput > 4096 || typeof thinking !== 'boolean') throw new Error('Invalid bounded model output settings');
  if (!Array.isArray(contextProfiles) || contextProfiles.length < 1 || contextProfiles.length > 2 || new Set(contextProfiles).size !== contextProfiles.length || contextProfiles.some(profile => !CONTEXT_PROFILES.includes(profile))) throw new Error('Choose one or two distinct supported context profiles');
  if (live && (!env.QWEN_API_KEY || !env.QWEN_BASE_URL)) throw new Error('Configure QWEN_API_KEY and QWEN_BASE_URL locally before --live.');
  const started = Date.now(), deadline = started + maxMs;
  const report = { version: 3, contextProfiles: [...contextProfiles], designKind: contextProfiles.length === 1 ? 'against-peilian' : 'context-comparison', mode: live ? 'live-card-play-pilot' : 'offline-harness-check', model: live ? model : 'local-peilian-fixture',
    startedAt: new Date(started).toISOString(), limits: { requests: maxRequests, wallMs: maxMs, decisionMs: 12000, outputTokens: maxOutput, errors: maxErrors, requestBytes: maxRequestBytes }, thinking, thinkingBudget: thinkingBudget ?? null,
    design: 'Identical hands, trump and burial within each seed. Two model partners versus preserved Peilian; swap model teams, covering all four seats. Every declared context profile uses the same fixtures. Bidding and burial are supplied by deterministic Peilian, not evaluated as model choices.',
    requests: [], games: [] };
  let errors = 0;
  for (const seed of seeds) {
    const fixture = cardPlayFixture(seed);
    // Alternate order across seeds to reduce systematic service/order effects.
    const profiles = seeds.indexOf(seed) % 2 ? [...contextProfiles].reverse() : contextProfiles;
    for (const profile of profiles) for (const team of [0, 1]) {
      if (Date.now() >= deadline || live && report.requests.length >= maxRequests || errors >= maxErrors) break;
      const game = { seed, profile, team, completed: false, dealer: fixture.dealer,
        sources: { api: 0, simulated: 0, forced: 0, fallback: 0, peilian: 0 },
        candidateSources: { api: 0, simulated: 0, forced: 0, fallback: 0 }, repairs: 0, errors: 0 };
      report.games.push(game);
      const session = new Session({ env, providerCall: async (view, seat, options) => {
        if (!live) return { action: choosePeilian(view, options.decisionId), usage: { input: 0, output: 0, cached: 0, cacheWrite: 0 }, ms: 0, simulated: true };
        if (report.requests.length >= maxRequests || Date.now() >= deadline) throw new Error('Pilot budget exhausted');
        const requestOptions = { ...options, env, contextProfile: profile, thinking, thinkingBudget,
          signal: AbortSignal.any([options.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]) };
        if (Buffer.byteLength(JSON.stringify(buildRequest(view, seat, requestOptions).body)) > maxRequestBytes) throw new Error('Pilot request size guard');
        const row = { index: report.requests.length + 1, seed, profile, team, phase: view.phase, seat: view.seat,
          repair: !!options.feedback, status: 'pending', startedAt: new Date().toISOString() };
        report.requests.push(row); await onProgress(report);
        try {
          const response = await call(view, seat, requestOptions);
          row.status = 'returned'; row.proposedAction = structuredClone(response.action); row.metering = response.metering; return response;
        } catch (error) { row.status = 'failed'; row.metering = error.metering || null; throw error; }
        finally { await onProgress(report); }
      }, audit: entry => {
        if (entry.type === 'request') {
          const row = report.requests.findLast(row => row.seed === seed && row.profile === profile && row.team === team && row.seat === entry.seat);
          if (row) row.outcome = entry.outcome;
        }
        if (entry.type === 'late_response') {
          report.lateUsage = [...(report.lateUsage || []), { seed, profile, team, seat: entry.seat,
            attempt: entry.attempt, applied: false, usage: entry.usage, metering: entry.metering }];
          // Reconciliation can arrive after runEvaluation returns. Save again so
          // the on-disk report includes its late label and corrected accounting.
          Promise.resolve().then(() => onProgress(report)).catch(() => {
            report.auditWriteFailed = true;
            console.error('Could not persist late pilot usage; the report may need reconciliation.');
          });
        }
      } });
      session.config = validateConfig({ dealing: 'ordered', seats: fixture.seats.map((seat, index) => index % 2 === team ?
        { ...seat, kind: 'api', provider: live ? 'qwen' : 'mock', model } : seat), limits: { maxRequests, maxOutput, timeoutMs: 12000 } }, { mock: true, qwen: true });
      session.state = structuredClone(fixture); session.state.seats = session.config.seats;
      // Manual evaluator clock: avoid Session's UI pacing timer creating duplicate steps.
      session.schedule = () => {};
      // Independently stop the runner at the pilot cutoff, even if a provider
      // ignores cancellation. Late usage is still audited by apiDecision.
      const wallGuard = setTimeout(() => session.stop(), Math.max(0, deadline - Date.now()));
      wallGuard.unref?.();
      let steps = 0;
      try {
        while (session.state.pending && !session.paused && steps++ < 200) {
          if (Date.now() >= deadline || live && report.requests.length >= maxRequests || errors + session.stats.errors >= maxErrors) break;
          session.config.limits.maxRequests = session.stats.realRequests + maxRequests - report.requests.length;
          const beforeVersion = session.state.version;
          await session.step(); assertConservation(session.state);
          const action = session.state.version > beforeVersion ? session.state.lastAction : null;
          if (action) game.sources[action.source] = (game.sources[action.source] || 0) + 1;
          if (action?.seat % 2 === team) game.candidateSources[action.source] = (game.candidateSources[action.source] || 0) + 1;
        }
      } finally { clearTimeout(wallGuard); session.stop(); }
      game.completed = !!session.state.score;
      game.stopReason = game.completed ? 'deal_complete' : session.paused ? 'engine_paused' : Date.now() >= deadline ? 'wall_time_guard' : report.requests.length >= maxRequests ? 'request_guard' : 'error_or_step_guard';
      game.score = session.state.score; game.stats = session.stats; game.errors = session.stats.errors;
      game.repairs = report.requests.filter(row => row.seed === seed && row.profile === profile && row.team === team && row.repair).length;
      game.tricks = session.state.tricks.length;
      if (game.completed) {
        const attack = team !== fixture.dealer % 2;
        game.margin = attack ? game.score.total - 80 : 80 - game.score.total;
        game.won = attack ? game.score.total >= 80 : game.score.total < 80;
      }
      errors += session.stats.errors; await onProgress(report);
    }
  }
  report.finishedAt = new Date().toISOString(); report.wallMs = Date.now() - started;
  report.stopReason = errors >= maxErrors ? 'error_guard' : Date.now() >= deadline ? 'wall_time_guard' : live && report.requests.length >= maxRequests ? 'request_guard' : 'schedule_complete';
  report.summary = summarizePairs(report.games, contextProfiles);
  await onProgress(report); return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const live = process.argv.includes('--live');
  try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const id = randomUUID(), directory = 'data/evaluations';
  await mkdir(directory, { recursive: true });
  let writes = Promise.resolve();
  const path = directory + '/paired-' + id + '.json';
  const report = await runEvaluation({ live, env: process.env, model: process.env.EVAL_MODEL || DEFAULT_TOKEN_PLAN_MODEL,
    onProgress: report => { const body = JSON.stringify(report, null, 2) + '\n'; writes = writes.then(() => writeFile(path, body, { mode: 0o600 })); return writes; } });
  console.log(JSON.stringify({ path, mode: report.mode, model: report.model, requests: report.requests.length, stopReason: report.stopReason, summary: report.summary }, null, 2));
}
