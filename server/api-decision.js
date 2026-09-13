import { choosePeilian } from '../src/peilian.js';
import { providerStatus } from '../src/providers.js';
import { normalizeUsage } from '../src/usage.js';
import { decisionTimeoutMs } from '../src/player-settings.js';
import { isTokenPlanEndpoint, tokenPlanModel } from '../src/model-catalog.js';
import { awaitProvider } from './await-provider.js';

// Shared by sequential card turns and concurrent, private declaration tasks.
export async function apiDecision(session, view, decision, {
  current, validate, fallbackView = () => view, privateDecision = false,
  cutoff = () => Infinity, register = () => {}, busy = () => {},
}) {
  const stats = session.stats, generation = session.generation;
  const seat = session.state.seats[decision.seat], gameId = session.state.id;
  const connection = session.connections ? session.connections.resolve(seat) : { env: session.env };
  const record = (entry) => {
    const data = { gameId, decisionId: decision.id, seat: decision.seat, phase: decision.phase, privateDecision, ...entry };
    session.audit(data);
    if (generation === session.generation) session.log(data);
  };
  const save = () => session.save(!privateDecision && generation === session.generation);
  const account = (usage, known, ms, metering, simulated) => {
    stats.input += usage.input ?? 0; stats.output += usage.output ?? 0;
    stats.cached += usage.cached ?? 0; stats.cacheWrite += usage.cacheWrite ?? 0; stats.reasoning += usage.reasoning ?? 0;
    if (!simulated && !known) stats.usageUnknown++;
    if (!simulated && usage.cached === null) stats.cacheUnknown++;
    if (metering?.referenceCost) { stats.referenceCostUsd += metering.referenceCost.amount; stats.referencePricedRequests++; }
    if (!simulated && Number.isFinite(ms)) { stats.latency.push(ms); stats.latency = stats.latency.slice(-500); }
  };
  const available = providerStatus(connection.env)[seat.provider] &&
    !(seat.provider === 'qwen' && !connection.allowCustomModel && isTokenPlanEndpoint(connection.env.QWEN_BASE_URL) && !tokenPlanModel(seat.model));
  let lastError = available ? '' : 'API 配置不可用，本次由陪练代打';
  const controller = new AbortController(), startedAt = Date.now();
  const waitMs = decisionTimeoutMs(session.config.limits.timeoutMs), maxDeadline = startedAt + waitMs;
  const deadline = () => Math.min(maxDeadline, cutoff());
  let timeout;
  const timeoutError = Object.assign(new Error('API 决策超时或亮主窗口即将结束，本次由陪练代打'), { code: 'API_DECISION_TIMEOUT' });
  const arm = () => {
    clearTimeout(timeout);
    if (!controller.signal.aborted) timeout = setTimeout(() => controller.abort(timeoutError), Math.max(0, deadline() - Date.now()));
  };
  register(controller, arm); arm();
  try {
    for (let attempt = 0; available && attempt < 2; attempt++) {
      if (!current()) return { source: 'cancelled' };
      if (controller.signal.aborted || Date.now() >= deadline()) { lastError = timeoutError.message; break; }
      if (seat.provider !== 'mock' && stats.realRequests >= session.config.limits.maxRequests) { lastError = '已达到本桌 API 请求上限，本次由陪练代打'; break; }
      busy({ seat: decision.seat, phase: decision.phase, api: seat.provider !== 'mock', simulated: seat.provider === 'mock', startedAt, deadlineAt: deadline(), attempt: attempt + 1 });
      record({ type: 'request_started', provider: seat.provider, model: seat.model, attempt });
      if (seat.provider !== 'mock') { stats.realRequests++; stats.requestsInFlight = (stats.requestsInFlight || 0) + 1; save(); }
      const started = performance.now();
      let usageReceived = false, metering = null, replyUsage = null;
      let unknownCounted = false, cacheUnknownCounted = false, finished = false, late = null;
      const reconcile = () => {
        if (!finished || !late) return;
        const { error, result } = late; late = null;
        const lateMetering = result?.metering || error?.metering || null;
        const usage = result?.usage || lateMetering?.usage, simulated = seat.provider === 'mock';
        if (usage) {
          if (unknownCounted) { stats.usageUnknown--; unknownCounted = false; }
          if (cacheUnknownCounted) { stats.cacheUnknown--; cacheUnknownCounted = false; }
          account(usage, lateMetering?.usageKnown ?? (result?.usageKnown !== false && usage.input != null && usage.output != null), undefined, lateMetering, simulated);
          if (simulated && result) stats.simulated++;
        }
        record({ type: 'late_response', provider: seat.provider, attempt, applied: false, usage: usage || null, metering: lateMetering });
        // Late usage must not become a public timing signal during a live deal.
        session.save(false);
      };
      try {
        const cardPlay = ['lead', 'follow'].includes(view.phase);
        const profile = cardPlay ? (seat.endgameAnalysis === false ? 'expert-read-' : 'expert-read-search-') :
          (seat.endgameAnalysis === false ? 'expert-facts-' : 'expert-search-');
        const result = await awaitProvider(session.providerCall(view, seat, { ...connection, contextProfile: profile + (seat.promptLanguage === 'en' ? 'en' : 'zh'), maxOutput: session.config.limits.maxOutput, signal: controller.signal, feedback: lastError, decisionId: decision.id }), controller.signal,
          (error, result) => { late = { error, result }; reconcile(); });
        usageReceived = true; metering = result.metering || null; replyUsage = result.usage;
        account(result.usage, result.usageKnown !== false, result.ms, metering, result.simulated);
        if (result.simulated) stats.simulated++;
        if (!current()) {
          record({ type: 'request', provider: seat.provider, cancelled: true, usage: replyUsage, metering, attempt });
          return { source: 'cancelled' };
        }
        if (Date.now() >= deadline()) { controller.abort(timeoutError); throw timeoutError; }
        validate(result.action, view);
        record({ type: 'request', provider: seat.provider, model: seat.model, simulated: result.simulated, outcome: 'valid', usage: result.usage, ms: result.ms, metering, attempt });
        return { action: result.action, view, source: result.simulated ? 'simulated' : 'api' };
      } catch (error) {
        if (!usageReceived && error.metering) {
          metering = error.metering; replyUsage = metering.usage; usageReceived = true;
          account(metering.usage, metering.usageKnown, metering.ms, metering, false);
          unknownCounted = !metering.usageKnown; cacheUnknownCounted = metering.usage.cached === null;
        } else if (!usageReceived && seat.provider !== 'mock') {
          account(normalizeUsage(seat.provider, null), false, performance.now() - started, null, false);
          unknownCounted = true; cacheUnknownCounted = true;
        }
        const superseded = error.code === 'SUPERSEDED_BID';
        record({ type: 'request', provider: seat.provider, model: seat.model, outcome: superseded ? 'superseded' : 'error', error: error.message,
          usage: replyUsage, metering, cancelled: !current(), ms: performance.now() - started, attempt });
        if (!current()) return { source: 'cancelled' };
        if (superseded) return { source: 'superseded' };
        stats.errors++; lastError = error.message;
        if (controller.signal.aborted || [400, 401, 403, 404, 422].includes(metering?.httpStatus)) break;
      } finally {
        if (seat.provider !== 'mock') stats.requestsInFlight--;
        finished = true; reconcile();
        session.save(false);
      }
    }
  } finally { clearTimeout(timeout); }
  if (!current()) return { source: 'cancelled' };
  const latest = fallbackView(), action = choosePeilian(latest, decision.id);
  validate(action, latest);
  stats.fallbacks++;
  record({ fallback: true, policy: 'peilian', reason: lastError });
  return { action, view: latest, source: 'fallback' };
}
