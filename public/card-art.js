import { SYMBOLS, rankLabel } from '../src/cards.js';

// Local vector-like card faces: no image download, font dependency, or canvas hit targets.
export function cardFace(card) {
  const joker = card.suit === 'X', suit = joker ? '✦' : SYMBOLS[card.suit], rank = rankLabel(card.rank);
  const corner = '<span class="rank">' + rank + '</span><span class="suit">' + suit + '</span>';
  const pips = card.rank === 14 ? 1 : Math.min(card.rank, 10);
  const center = joker ? '<span class="joker-emblem">✦<small>JOKER</small></span>' : card.rank > 10 && card.rank < 14 ?
    '<span class="court"><span>♛</span><b>' + rank + '</b><i>' + suit + '</i></span>' :
    '<span class="pips pips-' + pips + '">' + Array.from({ length: pips }, () => '<i>' + suit + '</i>').join('') + '</span>';
  return '<span class="corner top" aria-hidden="true">' + corner + '</span><span class="card-art" aria-hidden="true">' + center + '</span><span class="corner bottom" aria-hidden="true">' + corner + '</span>';
}
