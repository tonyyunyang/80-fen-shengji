import { rankLabel } from '../src/cards.js';
import { cardGlyph } from './card-glyphs.js';
const pips = {
  1:[[50,50]],2:[[50,15],[50,85]],3:[[50,15],[50,50],[50,85]],
  4:[[20,15],[80,15],[20,85],[80,85]],5:[[20,15],[80,15],[50,50],[20,85],[80,85]],
  6:[[20,15],[80,15],[20,50],[80,50],[20,85],[80,85]],7:[[20,15],[80,15],[50,32],[20,50],[80,50],[20,85],[80,85]],
  8:[[20,15],[80,15],[50,32],[20,50],[80,50],[50,68],[20,85],[80,85]],
  9:[[20,10],[80,10],[20,36],[80,36],[50,50],[20,64],[80,64],[20,90],[80,90]],
  10:[[20,10],[80,10],[50,23],[20,36],[80,36],[20,64],[80,64],[50,77],[20,90],[80,90]],
};
export function courtIndex(card) { return card.suit === 'X' ? card.rank === 16 ? 13 : 12 : ({S:0,H:3,C:6,D:9})[card.suit] + card.rank - 11; }

export function cardFace(card) {
  if (card.suit === 'X') {
    const cell=courtIndex(card);
    return `<span class="illustration joker-art atlas-${cell}"></span><span class="joker-index atlas-${cell}"></span>`;
  }
  const corner=`<b class="rank-glyph">${cardGlyph(rankLabel(card.rank))}</b><span class="suit suit-glyph">${cardGlyph(card.suit)}</span>`;
  const art=card.rank>=11 && card.rank<=13 ? `<span class="illustration atlas-${courtIndex(card)}"></span>` :
    `<span class="pips pips-${card.rank===14?1:card.rank}${card.rank===14?' ace':''}">${pips[card.rank===14?1:card.rank].map(([,y])=>`<i class="pip${y>50?' flip':''}">${cardGlyph(card.suit)}</i>`).join('')}</span>`;
  return `<span class="corner top">${corner}</span>${art}<span class="corner bottom">${corner}</span>`;
}
export function cardBack() { return '<span class="card-back" aria-hidden="true"></span>'; }
