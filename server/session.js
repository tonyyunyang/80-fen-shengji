import { randomUUID, randomInt } from 'node:crypto';
import { createGame, applyAction, observation, publicView, nextDeal, safeAction, isBidding, assertConservation } from '../src/game.js';
import { choosePeilian } from '../src/peilian.js';
import { requestAction, providerStatus, PROVIDERS } from '../src/providers.js';
import { DEFAULT_RULES, classify, enumerateLegalFollows } from '../src/rules.js';
import { decisionTimeoutMs, DEAL_INTERVAL_MS, boundedInteger, CLOSING_WINDOW_MS } from '../src/player-settings.js';
import { apiDecision } from './api-decision.js';
import { Bidding } from './bidding.js';
import { assertTokenPlanModel, DEFAULT_TOKEN_PLAN_MODEL } from '../src/model-catalog.js';

const emptyStats = () => ({ realRequests: 0, requestsInFlight: 0, simulated: 0, peilian: 0, forced: 0, input: 0, output: 0, cached: 0, cacheWrite: 0, errors: 0, fallbacks: 0, usageUnknown: 0, cacheUnknown: 0, reasoning: 0, referenceCostUsd: 0, referencePricedRequests: 0, latency: [] });
function restoredStats(value = {}) {
  const result = { ...emptyStats(), ...value };
  for (const key of Object.keys(emptyStats())) {
    if (key === 'latency' ? !Array.isArray(result[key]) || result[key].some(n => !Number.isFinite(n) || n < 0) : !Number.isFinite(result[key]) || result[key] < 0) throw new Error('存档用量无效');
  }
  return result;
}
export function validateConfig(input = {}, status = providerStatus()) {
  if (!input || typeof input !== 'object') throw new Error('牌桌设置格式无效');
  if (!Array.isArray(input.seats) || input.seats.length !== 4) throw new Error('请配置四个座位');
  const seats = input.seats.map((seat, index) => {
    if (!seat || !['human', 'peilian', 'api'].includes(seat.kind)) throw new Error('无效玩家类型');
    const provider = seat.kind === 'api' ? seat.provider || 'qwen' : null;
    if (provider && (!PROVIDERS.includes(provider) || !status[provider])) throw new Error('请先配置服务端 API，或选择离线模拟');
    const model = (typeof seat.model === 'string' ? seat.model.trim().slice(0, 120) : '') || (provider === 'qwen' ? DEFAULT_TOKEN_PLAN_MODEL : '');
    if (provider && provider !== 'mock' && !model) throw new Error('真实 API 座位需要模型 ID');
    return { kind: seat.kind, name: String(seat.name || ['你', '东家', '北家', '西家'][index]).slice(0, 24), provider, model,
      ...(typeof seat.connectionId === 'string' && /^[a-z0-9-]{1,50}$/.test(seat.connectionId) ? { connectionId: seat.connectionId } : {}) };
  });
  const rules = { ...DEFAULT_RULES, gates: input.rules?.gates === false ? [] : [...DEFAULT_RULES.gates] };
  if (input.rules?.partialTractorFollow === false) rules.partialTractorFollow = false;
  if (['off', 'redeal', 'scramble'].includes(input.rules?.fullRebel)) rules.fullRebel = input.rules.fullRebel;
  rules.speedRun = input.rules?.speedRun === true;
  const limits = {
    maxRequests: boundedInteger(input.limits?.maxRequests, 100, 0, 2000),
    timeoutMs: decisionTimeoutMs(input.limits?.timeoutMs),
    maxOutput: boundedInteger(input.limits?.maxOutput, 512, 128, 4096),
  };
  return { seats, rules, limits, dealing: input.dealing === 'ordered' || seats.filter(seat => seat.kind === 'human').length > 1 ? 'ordered' : 'continuous',
    dealIntervalMs: Number(input.dealIntervalMs) === 700 ? 700 : DEAL_INTERVAL_MS, speed: boundedInteger(input.speed, 600, 50, 2000) };
}
export class Session {
  constructor({ env = process.env, connections = null, providerCall = requestAction, persist = () => {}, audit = () => {} } = {}) {
    this.env = env; this.providerCall = providerCall; this.persist = persist; this.audit = audit;
    this.state = null; this.stats = emptyStats(); this.paused = false;
    this.generation = 0; this.logs = []; this.listeners = new Set();
    this.timer = null; this.abort = null; this.busy = null; this.autoplay = new Set();
    this.publishedStats = emptyStats(); this.publishedLogs = []; this.bidding = new Bidding(this);
    this.connections = connections; this.archives = [];
  }
  save(broadcast = true) {
    if (broadcast && !this.paused && isBidding(this.state)) this.bidding.ensure();
    this.persist({ schemaVersion: 3, state: this.state, stats: this.stats, config: this.config, logs: this.logs,
      publishedStats: this.publishedStats, publishedLogs: this.publishedLogs, dealClock: this.bidding.checkpoint(), pauseReason: this.pauseReason, archives: this.archives });
    if (broadcast) for (const listener of this.listeners) listener();
  }
  start(config) {
    const validated = validateConfig(config, this.connections ? { mock: true, openai: true, claude: true, qwen: true } : providerStatus(this.env));
    if (this.connections) validated.seats = validated.seats.map(seat => this.connections.bind(seat));
    else for (const seat of validated.seats) if (seat.provider === 'qwen') assertTokenPlanModel(seat.model, this.env.QWEN_BASE_URL);
    if (this.state) {
      // Keep the old stats object alive so a late provider reply can still meter it.
      this.archives.push({ id: this.state.id, at: new Date().toISOString(), completed: !!this.state.score, stats: this.stats });
      this.archives = this.archives.slice(-20);
    }
    this.stop();
    this.config = validated; this.stats = emptyStats(); this.logs = []; this.autoplay.clear();
    this.publishedStats = emptyStats(); this.publishedLogs = [];
    this.state = createGame({ id: randomUUID(), seed: randomInt(0x100000000), ...validated });
    this.paused = false; this.pauseReason = null; this.save(); this.schedule();
  }
  restart() {
    if (!this.state) throw new Error('请先开始牌局');
    this.start({ ...this.config, rules: { ...this.config.rules, gates: this.config.rules.gates.length > 0 } });
  }
  restore(data) {
    if (!data?.state) return;
    // Validate before replacing the current table, even when a local save is damaged.
    const state = structuredClone(data.state);
    if (!Array.isArray(state.seats) || state.seats.length !== 4 || !state.seats.every(s => ['human', 'peilian', 'api'].includes(s?.kind)) ||
      !['dealing', 'closing', 'rebel', 'bury', 'play', 'round_over', 'match_over'].includes(state.phase) || data.config?.seats?.length !== 4) throw new Error('存档格式无效');
    assertConservation(state);
    // Exercise each seat projection before accepting a save with missing rule,
    // match or history fields. This never sends observations to a provider.
    for (let seat = 0; seat < 4; seat++) observation(state, seat);
    const config = { ...data.config, limits: {
      maxRequests: boundedInteger(data.config.limits?.maxRequests, 100, 0, 2000),
      timeoutMs: decisionTimeoutMs(data.config.limits?.timeoutMs), maxOutput: boundedInteger(data.config.limits?.maxOutput, 512, 128, 4096),
    } };
    const clock = data.dealClock ? { ...data.dealClock,
      drawRemaining: data.dealClock.drawRemaining == null ? null : boundedInteger(data.dealClock.drawRemaining, 500, 0, 700),
      closingRemaining: data.dealClock.closingRemaining == null ? null : boundedInteger(data.dealClock.closingRemaining, 5000, 0, CLOSING_WINDOW_MS),
    } : null;
    if (clock && (!Array.isArray(clock.completed) || clock.completed.length !== 4 || clock.completed.some(key => key !== null && typeof key !== 'string'))) throw new Error('存档时钟无效');
    const stats = restoredStats(data.stats), publishedStats = restoredStats(data.publishedStats);
    const archives = (Array.isArray(data.archives) ? data.archives : []).slice(-20).map(item => ({ id: String(item.id), at: String(item.at), completed: !!item.completed, stats: restoredStats(item.stats) }));
    for (const item of archives) {
      item.stats.usageUnknown += item.stats.requestsInFlight; item.stats.cacheUnknown += item.stats.requestsInFlight; item.stats.requestsInFlight = 0;
    }
    if ((data.logs && !Array.isArray(data.logs)) || (data.publishedLogs && !Array.isArray(data.publishedLogs))) throw new Error('存档记录无效');
    this.stop(); this.state = state; this.config = config; this.autoplay.clear();
    this.bidding = new Bidding(this);
    this.stats = stats; this.logs = data.logs || [];
    this.archives = archives;
    this.stats.usageUnknown += this.stats.requestsInFlight || 0;
    this.stats.cacheUnknown += this.stats.requestsInFlight || 0;
    this.stats.requestsInFlight = 0;
    // Older samples mixed simulation and real requests; do not label those as API latency.
    if (![2, 3].includes(data.schemaVersion)) this.stats.latency = [];
    this.publishedStats = publishedStats; this.publishedLogs = data.publishedLogs || [];
    this.bidding.restore(clock);
    this.paused = true; this.pauseReason = 'restored'; this.save();
  }
  stop() {
    this.generation++; clearTimeout(this.timer); this.abort?.abort(); this.bidding.stop();
    this.abort = null; this.busy = null;
  }
  pause(value, reason = 'manual') {
    this.stop(); this.paused = value;
    this.pauseReason = value ? reason : null;
    if (!value && isBidding(this.state)) this.bidding.ensure();
    this.save();
    if (!value) this.schedule();
  }
  log(entry) {
    this.logs.push({ at: new Date().toISOString(), ...entry });
    this.logs = this.logs.slice(-500);
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.paused) return;
    if (isBidding(this.state)) { this.bidding.schedule(); return; }
    if (!this.state?.pending) return;
    const seat = this.state.seats[this.state.pending.seat];
    if (seat.kind === 'human' && !this.autoplay.has(this.state.pending.seat)) return;
    this.timer = setTimeout(() => this.step(), this.state.pending.phase === 'declare' ? Math.min(100, this.config.speed) : this.config.speed);
    this.timer.unref?.();
  }
  commit(action, source, decision = this.state.pending) {
    this.state = applyAction(this.state, { decisionId: decision.id, version: decision.version, seat: decision.seat, action, source });
  }
  async step() {
    if (isBidding(this.state)) { this.bidding.tick(); return; }
    if (!this.state?.pending || this.paused || this.busy) return;
    const decision = structuredClone(this.state.pending), generation = this.generation;
    const view = observation(this.state, decision.seat), seat = this.state.seats[decision.seat];
    const current = () => generation === this.generation && this.state?.pending?.id === decision.id && !this.paused;
    this.busy = { seat: decision.seat, phase: decision.phase, api: false, simulated: seat.provider === 'mock' };
    this.save();
    try {
      let action, source;
      const moves = decision.phase === 'follow' ? enumerateLegalFollows(view.hand, classify(view.plays[0].cards, view.trump), view.trump, view.rules) : null;
      const forced = moves?.length === 1 || decision.phase === 'follow' && view.hand.length === view.plays[0].cards.length || decision.phase === 'lead' && view.hand.length === 1;
      if (forced) { action = moves?.length === 1 ? { type: 'play', cardIds: moves[0] } : safeAction(view); source = 'forced'; this.stats.forced++; }
      else if (seat.kind !== 'api') { action = choosePeilian(view, decision.id); source = seat.kind === 'human' ? 'autoplay' : 'peilian'; this.stats.peilian++; }
      else {
        const result = await apiDecision(this, view, decision, {
          current,
          validate: (action) => applyAction(this.state, { decisionId: decision.id, version: decision.version, seat: decision.seat, action }),
          register: (controller) => { this.abort = controller; },
          busy: (value) => { this.busy = value; },
        });
        action = result.action; source = result.source;
      }
      if (current() && action) this.commit(action, source, decision);
    } catch (error) {
      if (current()) { this.paused = true; this.log({ error: error.message }); }
    } finally {
      if (generation === this.generation) { this.busy = null; this.abort = null; this.save(); this.schedule(); }
      else this.save(false);
    }
  }
  human(envelope) {
    if (!this.state || this.state.seats[envelope.seat]?.kind !== 'human') throw new Error('该座位由机器控制');
    if (this.paused) throw new Error('请先继续牌局');
    if (this.autoplay.has(envelope.seat)) throw new Error('请先收回托管，再手动操作');
    if (envelope.bidContext && envelope.action?.type === 'declare' && !isBidding(this.state)) return;
    if (isBidding(this.state)) { this.bidding.human(envelope); return; }
    this.state = applyAction(this.state, { ...envelope, source: 'human' });
    this.save(); this.schedule();
  }
  next() {
    const next = nextDeal(this.state);
    this.stop(); this.publishedStats = structuredClone(this.stats); this.publishedLogs = structuredClone(this.logs);
    this.state = next; this.paused = false; this.pauseReason = null; this.save(); this.schedule();
  }
  setAutoplay(seat, enabled) {
    if (this.state?.seats[seat]?.kind !== 'human') throw new Error('只有人类座位可切换托管');
    if (enabled) this.autoplay.add(seat); else this.autoplay.delete(seat);
    this.save(); this.schedule();
  }
  view(seat) {
    const statsDeferred = this.state?.dealing === 'continuous' && !this.state.score;
    const stats = statsDeferred ? this.publishedStats : this.stats;
    const latencies = [...stats.latency].sort((a, b) => a - b);
    return { game: this.state ? publicView(this.state, seat) : null, paused: this.paused, pauseReason: this.pauseReason, busy: isBidding(this.state) ? null : this.busy,
      dealClock: isBidding(this.state) ? this.bidding.publicClock() : null, statsDeferred,
      autoplay: [...this.autoplay], stats: { ...stats, latency: undefined, latencyCount: latencies.length,
        mean: latencies.length ? latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length : 0,
        p50: latencies[Math.max(0, Math.ceil(latencies.length * .5) - 1)] || 0, p95: latencies[Math.max(0, Math.ceil(latencies.length * .95) - 1)] || 0 },
      logs: (statsDeferred ? this.publishedLogs : this.logs).slice(-40), providers: this.connections ? this.connections.status() : providerStatus(this.env), config: this.config,
      archives: this.archives.map(({ stats, ...item }) => ({ ...item, requests: stats.realRequests, input: stats.input, output: stats.output, unknown: stats.usageUnknown,
        pending: stats.requestsInFlight, cost: stats.referenceCostUsd, priced: stats.referencePricedRequests })) };
  }
}
