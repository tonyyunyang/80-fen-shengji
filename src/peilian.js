import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { randomSource } from './cards.js';
const require = createRequire(import.meta.url);
const bot = require('../vendor/peilian/reference-core.cjs');

export function choosePeilian(view, decisionId = '', { deterministic = false } = {}) {
  // Copy observations: the original policy attaches private working fields to its input.
  const v = structuredClone(view);
  Object.assign(bot.RULES, v.rules);
  const seed = createHash('sha256').update(decisionId).digest().readUInt32LE();
  const random = randomSource(seed);
  if (v.phase === 'declare') {
    const context = {
      vis: v.hand, seat: v.seat, trumpRank: v.trumpRank, curDecl: v.curDecl,
      dealerKnown: v.dealerKnown, dealer: v.dealer, firstTaker: v.firstTaker,
      gates: v.gates, levels: v.levels,
    };
    let choice = null;
    if (bot.canReinforce2(v.curDecl, v.seat, v.hand, v.trumpRank, v.rebelHappened)) {
      const pair = bot.scoreDeclOption(context, { suit: v.curDecl.suit, strength: 2 }).score;
      const single = bot.scoreDeclOption(context, { suit: v.curDecl.suit, strength: 1, hasPair: true }).score;
      if (pair > single && (deterministic || random() < 0.9)) choice = { suit: v.curDecl.suit, strength: 2 };
    }
    if (!choice) {
      const decision = bot.aiDeclDecide(context);
      if (decision && decision.score >= decision.threshold && (deterministic || random() < Math.min(0.95, 0.45 + (decision.score - decision.threshold) / 40))) choice = decision.opt;
    }
    const option = v.options?.find((option) => option.suit === choice?.suit && option.strength === choice?.strength);
    return { type: 'declare', choice: option?.id || 'pass' };
  }
  if (v.phase === 'rebel') return { type: 'rebel', accept: random() < 0.7 };
  if (v.phase === 'bury') return { type: 'bury', cardIds: bot.aiDiscard(v.hand, v.trump).map((card) => card.id) };
  const result = v.phase === 'lead' ? bot.aiChooseLead(v) : bot.aiChooseFollow(v, v.plays);
  return { type: 'play', cardIds: result.cards.map((card) => card.id) };
}
