import { isBidding, drawCard, closeBidding, observation, applyBid } from '../src/game.js';
import { choosePeilian } from '../src/peilian.js';
import { BID_REVIEW_INTERVAL_MS, DEAL_INTERVAL_MS, CLOSING_WINDOW_MS } from '../src/player-settings.js';
import { apiDecision } from './api-decision.js';

export const bidKey = (view) => JSON.stringify(view.bidContext);
const scope = (state) => state.id + ':' + state.attempts;
export class Bidding {
  constructor(session) {
    this.session = session; this.jobs = new Map(); this.completed = [null, null, null, null]; this.started = [-Infinity, -Infinity, -Infinity, -Infinity];
    this.epoch = null; this.timer = null; this.nextDrawAt = null; this.closeAt = null; this.lastDrawAt = null; this.saved = null;
  }
  ensure() {
    const s = this.session;
    if (!isBidding(s.state)) return;
    const epoch = scope(s.state);
    if (this.epoch !== epoch) {
      this.stop(); this.epoch = epoch; this.completed.fill(null); this.started.fill(-Infinity); this.saved = null; this.lastDrawAt = null;
    }
    if (this.nextDrawAt === null && s.state.phase === 'dealing') this.nextDrawAt = Date.now() + (this.saved?.drawRemaining ?? s.config.dealIntervalMs ?? DEAL_INTERVAL_MS);
    if (this.closeAt === null && s.state.phase === 'closing') this.closeAt = Date.now() + (this.saved?.closingRemaining ?? CLOSING_WINDOW_MS);
    this.saved = null;
  }
  checkpoint() {
    return this.saved || { epoch: this.epoch, drawRemaining: this.nextDrawAt === null ? null : Math.max(0, this.nextDrawAt - Date.now()),
      closingRemaining: this.closeAt === null ? null : Math.max(0, this.closeAt - Date.now()), completed: [...this.completed] };
  }
  restore(data) {
    if (!data) return;
    this.epoch = data.epoch; this.saved = data; this.completed = data.completed || [null, null, null, null];
  }
  stop() {
    if (this.epoch) this.saved = this.checkpoint();
    clearTimeout(this.timer); this.timer = null; this.nextDrawAt = null; this.closeAt = null;
    for (const job of this.jobs.values()) job.controller?.abort();
    this.jobs.clear();
  }
  current(job) {
    const s = this.session;
    return !s.paused && s.generation === job.generation && isBidding(s.state) && scope(s.state) === job.epoch && this.jobs.get(job.seat) === job &&
      (s.state.phase !== 'closing' || Date.now() < this.closeAt);
  }
  validate(action, view, seat) {
    if (action?.type !== 'declare') throw new Error('需要亮主工具动作');
    if (this.session.state.phase === 'closing' && Date.now() >= this.closeAt) throw Object.assign(new Error('亮主窗口已关闭'), { code: 'SUPERSEDED_BID' });
    return applyBid(this.session.state, { ...view.bidContext, seat, choice: action.choice }, view.options.map(option => option.id));
  }
  submit(action, view, seat, source, decisionId) {
    const next = this.validate(action, view, seat);
    if (next === this.session.state) return false;
    this.session.state = applyBid(this.session.state, { ...view.bidContext, seat, choice: action.choice, source, decisionId }, view.options.map(option => option.id));
    if (this.session.state.phase === 'closing') {
      this.closeAt = Date.now() + CLOSING_WINDOW_MS;
      for (const job of this.jobs.values()) job.arm?.();
    }
    this.session.save();
    return true;
  }
  human(envelope) {
    this.ensure();
    const { bidContext, seat, action } = envelope;
    if (!bidContext) throw new Error('缺少亮主上下文');
    if (action?.type !== 'declare') throw new Error('需要亮主动作');
    if (this.session.state.phase === 'closing' && Date.now() >= this.closeAt) return;
    try {
      const next = applyBid(this.session.state, { ...bidContext, seat, choice: action?.choice, source: 'human' });
      if (next !== this.session.state) {
        this.session.state = next;
        if (next.phase === 'closing') { this.closeAt = Date.now() + CLOSING_WINDOW_MS; for (const job of this.jobs.values()) job.arm?.(); }
        this.session.save(); this.schedule();
      }
    } catch (error) { if (error.code !== 'SUPERSEDED_BID') throw error; }
  }
  review() {
    const s = this.session;
    if (s.state.phase === 'closing' && Date.now() >= this.closeAt - 100) return;
    for (let seat = 0; seat < 4; seat++) {
      const player = s.state.seats[seat];
      if (player.kind === 'human' && !s.autoplay.has(seat) || this.jobs.has(seat)) continue;
      const view = observation(s.state, seat), key = bidKey(view);
      if (!view.options.length || this.completed[seat] === key) continue;
      if (player.kind === 'api' && Date.now() < this.started[seat] + BID_REVIEW_INTERVAL_MS) continue;
      const job = { seat, key, epoch: scope(s.state), generation: s.generation, id: `${s.state.id}:deal:${s.state.attempts}:bid:${seat}:${key}` };
      this.jobs.set(seat, job); this.started[seat] = Date.now();
      job.promise = this.decide(job, view);
    }
  }
  async decide(job, view) {
    const s = this.session, player = s.state.seats[job.seat];
    try {
      const result = player.kind === 'api' ? await apiDecision(s, view, { id: job.id, seat: job.seat, phase: 'declare' }, {
        current: () => this.current(job), privateDecision: true,
        cutoff: () => s.state.phase === 'closing' ? this.closeAt - 100 : Infinity,
        register: (controller, arm) => { job.controller = controller; job.arm = arm; },
        validate: (action, offered) => this.validate(action, offered, job.seat),
        fallbackView: () => observation(s.state, job.seat),
      }) : { action: choosePeilian(view, job.id), view, source: player.kind === 'human' ? 'autoplay' : 'peilian' };
      if (!this.current(job) || result.source === 'cancelled') return;
      this.completed[job.seat] = result.view ? bidKey(result.view) : job.key;
      if (player.kind !== 'api') s.stats.peilian++;
      if (result.action) {
        try { this.submit(result.action, result.view, job.seat, result.source, job.id); }
        catch (error) { if (error.code !== 'SUPERSEDED_BID') throw error; }
      }
    } catch (error) {
      if (this.current(job)) { s.paused = true; s.log({ error: error.message }); this.stop(); s.save(); }
    } finally {
      if (this.jobs.get(job.seat) === job) {
        this.jobs.delete(job.seat); s.save(false); this.schedule();
      }
    }
  }
  tick() {
    const s = this.session;
    if (s.paused || !isBidding(s.state)) return;
    this.ensure();
    if (s.state.phase === 'dealing' && Date.now() >= this.nextDrawAt) {
      s.state = drawCard(s.state); this.lastDrawAt = Date.now();
      this.nextDrawAt = Date.now() + (s.config.dealIntervalMs || DEAL_INTERVAL_MS);
      if (s.state.phase === 'closing') {
        this.nextDrawAt = null; this.closeAt = Date.now() + CLOSING_WINDOW_MS;
        for (const job of this.jobs.values()) job.arm?.();
      }
      s.save();
    }
    if (s.state.phase === 'closing' && Date.now() >= this.closeAt) {
      s.state = closeBidding(s.state); this.stop(); s.save(); s.schedule(); return;
    }
    this.review(); this.schedule();
  }
  schedule() {
    clearTimeout(this.timer);
    const s = this.session;
    if (s.paused || !isBidding(s.state)) return;
    this.ensure();
    let at = s.state.phase === 'dealing' ? this.nextDrawAt : this.closeAt;
    for (let seat = 0; seat < 4; seat++) {
      if (this.jobs.has(seat) || s.state.seats[seat].kind === 'human' && !s.autoplay.has(seat)) continue;
      const view = observation(s.state, seat);
      if (view.options.length && this.completed[seat] !== bidKey(view) && (s.state.phase !== 'closing' || Date.now() < this.closeAt - 100)) {
        at = Math.min(at, s.state.seats[seat].kind === 'api' ? Math.max(Date.now() + 1, this.started[seat] + BID_REVIEW_INTERVAL_MS) : Date.now() + 1);
      }
    }
    this.timer = setTimeout(() => this.tick(), Math.max(1, at - Date.now())); this.timer.unref?.();
  }
  publicClock() {
    return { closingAt: this.closeAt, lastDrawAt: this.lastDrawAt, pausedRemaining: this.saved?.closingRemaining ?? null };
  }
}
