export const TRICK_TIMING = Object.freeze({ hold: 850, flip: 300, collect: 450 });
export const SUIT_NAMES = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' };

export function tableScope(game) {
  return game ? game.id + ':' + (game.events.findLast(event => event.type === 'deal_started')?.seq ?? 0) + ':' + game.viewer : null;
}

// This clock is presentation only. It never delays a draw or an API decision.
// Keep at most one completed public trick; fast spectators cannot build a backlog.
export class TrickFlow {
  constructor() { this.scope = null; this.seen = 0; this.active = null; }
  update(game, { now, paused = false, reducedMotion = false, hidden = false }) {
    const scope = tableScope(game), count = game?.tricks.length || 0;
    if (scope !== this.scope || count < this.seen) {
      this.scope = scope; this.seen = count; this.active = null;
    } else if (count > this.seen) {
      this.active = { trick: structuredClone(game.tricks.at(-1)), at: now, key: scope + ':' + (count - 1) };
      this.seen = count;
    }
    if (paused || reducedMotion || hidden) this.active = null;
    if (!this.active) return null;
    const elapsed = Math.max(0, now - this.active.at);
    const { hold, flip, collect } = TRICK_TIMING;
    if (elapsed >= hold + flip + collect) { this.active = null; return null; }
    const phase = elapsed < hold ? 'hold' : elapsed < hold + flip ? 'flip' : 'collect';
    const start = phase === 'hold' ? 0 : phase === 'flip' ? hold : hold + flip;
    const duration = TRICK_TIMING[phase];
    return { ...this.active, phase, phaseElapsed: elapsed - start, remaining: start + duration - elapsed };
  }
}

export function tableFacts(game) {
  const last = game.tricks.at(-1) || null;
  const settled = !!game.trump;
  const sameLevel = game.match.levels[0] === game.match.levels[1];
  // match.levels already advances at the final trick; trump.rank belongs to this deal.
  const rank = game.trump?.rank ?? (game.declaration || game.match.dealer >= 0 ? game.trumpRank : sameLevel ? game.match.levels[0] : null);
  const suit = settled ? game.trump.suit : game.declaration?.suit;
  return {
    rank, suit, settled, last,
    suitName: settled || game.declaration ? suit ? SUIT_NAMES[suit] + '主' : '无主' : '待亮主',
    suitLabel: settled ? '主花色' : game.declaration ? '当前亮主' : '主花色待定',
    dealer: game.dealer >= 0 ? game.dealer : game.declaration?.seat ?? null,
    dealerLabel: !settled && game.match.dealer < 0 ? '暂定庄家' : '庄家',
    liveTrick: game.score ? game.tricks.length : game.tricks.length + 1,
  };
}
