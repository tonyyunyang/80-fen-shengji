import { tableScope } from './table-flow.js';

// Presentation consumes an allowlist of public events. Never key a flourish to
// pending decisions, provider work, private draws, eligibility or usage records.
export class EffectFlow {
  constructor() { this.scope = null; this.seen = -1; this.dealt = 0; this.collection = null; this.result = null; }

  update(game, { active = true, motion = null } = {}) {
    const scope = tableScope(game);
    const events = game?.events || [];
    const last = events.at(-1)?.seq ?? -1;
    if (scope !== this.scope || last < this.seen) {
      this.scope = scope; this.seen = last; this.dealt = game?.dealt || 0;
      this.collection = null; this.result = null;
      return [];
    }
    const fresh = events.filter(event => event.seq > this.seen);
    this.seen = last;
    const drew = (game?.dealt || 0) > this.dealt;
    this.dealt = game?.dealt || 0;
    if (!game || !active) { this.collection = motion?.key || null; this.result = null; return []; }

    const cues = [];
    if (drew && ['dealing', 'closing'].includes(game.phase)) cues.push({ type: 'deal' });
    // A burst of updates is represented by the most recent event of each kind.
    // There is no queue of unseen plays or ceremonies to catch up later.
    for (const type of ['declaration', 'trump_set', 'play', 'trick', 'round_scored']) {
      const event = fresh.findLast(item => item.type === type && (!item.audience || item.audience === 'public'));
      if (!event) continue;
      if (type === 'declaration') cues.push({ type, seat: event.seat, suit: event.suit, strength: event.strength });
      if (type === 'trump_set') cues.push({ type, seat: event.dealer });
      if (type === 'play') cues.push({ type, seat: event.seat, index: event.trick, count: event.cards.length });
      if (type === 'trick') cues.push({ type: 'capture', index: event.index, winner: event.winner, points: event.points });
      if (type === 'round_scored') this.result = { type: 'result', total: game.score.total,
        winner: game.score.attackersWin ? 1 - game.dealer % 2 : game.dealer % 2, complete: game.match.winner >= 0 };
    }
    if (motion?.phase === 'collect' && motion.key !== this.collection) {
      this.collection = motion.key;
      cues.push({ type: 'collect', index: motion.trick.index, winner: motion.trick.winner, points: motion.trick.points });
    }
    if (this.result && !motion) { cues.push(this.result); this.result = null; }
    return cues;
  }
}
