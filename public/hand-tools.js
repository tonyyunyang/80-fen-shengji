import { errorText } from './errors.js';
import { t } from './i18n.js';
import { classify, followError, resolveCards } from '../src/rules.js';

export function selectionError(game, ids) {
  if (!ids.length) return t('先选牌，再出牌');
  let cards;
  try { cards = resolveCards(game.hand, ids); } catch (error) { return errorText(error.message); }
  if (game.pending?.phase === 'bury') return cards.length === 8 ? null : t('底牌需要恰好 8 张，还') + (cards.length < 8 ? t('差 ') + (8 - cards.length) : t('多 ') + (cards.length - 8)) + t(' 张');
  if (game.pending?.phase === 'follow') return errorText(followError(game.hand, cards, classify(game.plays[0].cards, game.trump), game.trump, game.rules));
  if (game.pending?.phase === 'lead') return classify(cards, game.trump) ? null : t('领出的牌需要属于同一有效花色（主牌算一类）');
  return t('现在无需选牌');
}

export function selectRange(hand, selected, anchor, id) {
  const start = hand.findIndex(card => card.id === anchor), end = hand.findIndex(card => card.id === id);
  const next = new Set(selected);
  if (start < 0 || end < 0) { next.add(id); return next; }
  for (const card of hand.slice(Math.min(start, end), Math.max(start, end) + 1)) next.add(card.id);
  return next;
}
export function selectPair(hand, selected, id) {
  const face = hand.find(card => card.id === id), next = new Set(selected);
  if (face) for (const card of hand) if (card.suit === face.suit && card.rank === face.rank) next.add(card.id);
  return next;
}

// Preserve physical identities and hand order, even for a scattered selection.
// An unselected card never picks up an unrelated selected group.
export function dragCardIds(hand, selected, id) {
  if (!hand.some(card => card.id === id)) return [];
  return selected.has(id) ? hand.filter(card => selected.has(card.id)).map(card => card.id) : [id];
}
