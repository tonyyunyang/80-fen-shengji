import { errorText } from './errors.js';
import { t, pick, rankLabel } from './i18n.js';
import { effectiveSuit } from '../src/cards.js';
import { classify, followError, resolveCards } from '../src/rules.js';

function followRequirement(game) {
  const lead = classify(game.plays[0].cards, game.trump);
  const held = game.hand.filter(card => effectiveSuit(card, game.trump) === lead.suit).length;
  const names = {T:pick('主牌','trump'),S:pick('黑桃','spade'),H:pick('红桃','heart'),D:pick('方块','diamond'),C:pick('梅花','club')};
  return { count:lead.cards.length, required:Math.min(held,lead.cards.length), suit:lead.suit, name:names[lead.suit] };
}

export function followPrompt(game) {
  const {count,required,name} = followRequirement(game);
  const cards = n => `${n} ${name} card${n === 1 ? '' : 's'}`;
  if (required === count) return pick(`跟出 ${count} 张${name}`,`Follow with ${cards(count)}`);
  if (required) return pick(`跟出 ${count} 张 · 先跟 ${required} 张${name}`,`Play ${count} cards · include ${cards(required)}`);
  return pick(`跟出 ${count} 张 · 已无${name}`,`Play ${count} cards · no ${name} cards left`);
}

function followSelectionError(game, cards) {
  const error = followError(game.hand,cards,classify(game.plays[0].cards,game.trump),game.trump,game.rules);
  if (error !== '有领出花色时必须尽量跟足') return errorText(error);
  const {required,suit,name} = followRequirement(game);
  const noTrump = suit === 'T' && !game.trump.suit;
  return pick(`需先跟 ${required} 张${name}`,`Include ${required} ${name} card${required === 1 ? '' : 's'}`) + (noTrump ?
    pick(`（无主时，王和所有 ${rankLabel(game.trump.rank)} 都是主牌）`,` (no-trump still includes jokers and every ${rankLabel(game.trump.rank)})`) : '');
}

export function selectionError(game, ids) {
  if (!ids.length) return t('先选牌，再出牌');
  let cards;
  try { cards = resolveCards(game.hand, ids); } catch (error) { return errorText(error.message); }
  if (game.pending?.phase === 'bury') return cards.length === 8 ? null : t('底牌需要恰好 8 张，还') + (cards.length < 8 ? t('差 ') + (8 - cards.length) : t('多 ') + (cards.length - 8)) + t(' 张');
  if (game.pending?.phase === 'follow') return followSelectionError(game, cards);
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
