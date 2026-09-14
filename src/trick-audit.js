import { makeDeck, points } from './cards.js';
import { classify, resolveTrick } from './rules.js';
import { publicPlays } from './notebook.js';

const signature = shape => shape?.parts.map(p => p.type + ':' + p.len).sort().join(',');

// Bounds use only public plays and our hand, never hidden engine state.
// Ignoring strategic burial/ownership constraints makes them conservative;
// these are not probabilities or predictions of a particular allocation.
export function kittyPointBounds(view) {
  const played = publicPlays(view).flatMap(p => p.cards);
  const known = view.buriedKnown || [], size = view.kittySize ?? 8;
  const cards = [...played, ...view.hand, ...known], ids = new Set(cards.map(c => c.id));
  const deck = makeDeck(), byId = new Map(deck.map(c => [c.id, c]));
  const valid = cards.every(c => byId.get(c.id)?.suit === c.suit && byId.get(c.id)?.rank === c.rank);
  const remaining = view.handSizes;
  if (!valid || ids.size !== cards.length || size !== 8 || (known.length && known.length !== size) ||
      !Array.isArray(remaining) || remaining.length !== 4 || remaining.some(n => !Number.isInteger(n) || n < 0) ||
      remaining[view.seat] !== view.hand.length ||
      played.length + remaining.reduce((a, b) => a + b, 0) + size !== 108) {
    return { range: null, basis: 'incomplete_or_inconsistent_public_inventory' };
  }
  if (known.length) return { range: [points(known), points(known)], basis: 'your_known_burial' };
  const values = deck.filter(c => !ids.has(c.id)).map(c => points([c])).sort((a, b) => a - b);
  return {
    range: [values.slice(0, size).reduce((a, b) => a + b, 0), values.slice(-size).reduce((a, b) => a + b, 0)],
    basis: values.length === size ? 'deduced_from_complete_public_inventory' : 'conservative_public_inventory_bounds',
  };
}

export function buildTrickAudit(view, moves) {
  if (!view.trump || !['lead', 'follow'].includes(view.phase)) return null;
  const current = view.plays, kitty = kittyPointBounds(view);
  const result = {
    tieRule: 'earlier_equal_wins; physical IDs never break strength ties',
    attackPointsBeforeTrick: view.attackPoints,
    kitty: { ...kitty, multiplierPerFinalLeadCard: 2, awardedOnlyIfAttackersWinFinalTrick: true },
  };
  if (!current.length) return result;
  const winner = resolveTrick(current, view.trump).winner;
  const winning = current.find(p => p.seat === winner), shape = classify(winning.cards, view.trump);
  const lead = classify(current[0].cards, view.trump);
  result.winnerSoFar = { seat: winner, card_ids: winning.cards.map(c => c.id), effectiveSuit: shape.suit, type: shape.type, topOrder: shape.top };
  result.equalStrengthMoveIds = moves ? [] : null;
  result.finalTrick = view.hand.length === lead.cards.length;
  // Only an action closing the last trick permits a final settlement.
  const closesDeal = result.finalTrick && current.length === 3;
  if (closesDeal) result.finalWithKitty = [];
  for (const [move_id, ids] of (moves || []).entries()) {
    const cards = ids.map(id => view.hand.find(c => c.id === id)), candidate = classify(cards, view.trump);
    if (candidate && signature(candidate) === signature(lead) && candidate.suit === shape.suit && candidate.top === shape.top) {
      result.equalStrengthMoveIds.push(move_id);
    }
    if (!closesDeal) continue;
    const end = resolveTrick([...current, { seat: view.seat, cards }], view.trump);
    const attackersLast = end.winner % 2 !== view.declSeat % 2;
    const visibleTotal = view.attackPoints + (attackersLast ? end.points : 0);
    const range = !attackersLast ? [visibleTotal, visibleTotal] : kitty.range?.map(value => visibleTotal + value * 2 * lead.cards.length) ?? null;
    const winningTeam = !range ? null : range[0] >= 80 ? 1 - view.declSeat % 2 : range[1] < 80 ? view.declSeat % 2 : null;
    result.finalWithKitty.push({ move_id, trickWinner: end.winner, attackerFinalPointsRange: range,
      dealResult: winningTeam === null ? 'uncertain' : winningTeam === view.seat % 2 ? 'win' : 'loss' });
  }
  return result;
}

export const TRICK_AUDIT_PROMPT = {
  zh: '规则与记账核对：同花色同点数的两张单牌同大，后出的不能压先出的。例如先出黑桃A，后出另一张黑桃A，仍是先出的那家大；物理ID大小不参与比较。不同副级牌也同大，无主时所有级牌同大；同有效花色、匹配结构的相同大小出牌同样先出者大。trickAudit.equalStrengthMoveIds明确列出不能盖过当前赢家的同大动作；主牌将吃副牌仍按正常规则比较。history现在只含已完成的墩，每四次出牌为一墩；trick单独列出当前墩，不可重复记分或数牌。attackPoints是已收墩的攻分，不含当前墩及尚未结算的底分。trickAudit.kitty给出本人已知底分或仅从公开牌与本人手牌推出的保守上下界，不是平均值或概率；null表示信息不足。早期的clinchesAttackerTakeover等字段只计算可见墩分；末墩若有finalWithKitty，应以其中含抠底倍数的结算判断80分胜负。',
  en: 'Rules/accounting audit: two singles of identical printed suit and rank tie; the later copy cannot overtake the earlier copy. For example, a second spade ace does not beat the first spade ace. Physical ID magnitude never breaks ties. Off-suit level cards also tie; in no-trump all level cards tie. Earlier equal plays win for matching structures in the same effective suit. trickAudit.equalStrengthMoveIds identifies equal moves that cannot replace the current winner; trump ruffs still follow the ordinary rules. history now contains ONLY completed tricks, four plays each; trick contains the current trick separately. Never count either twice. attackPoints contains collected attacker trick points, excluding this trick and unsettled kitty points. trickAudit.kitty gives known burial points or conservative bounds deduced solely from public cards and your hand, not an average or probability; null means insufficient information. Older clinchesAttackerTakeover fields count visible trick points only; on the last trick use finalWithKitty when present to assess the final 80-point result including the kitty multiplier.',
};
