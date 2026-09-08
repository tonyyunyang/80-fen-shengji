import { makeDeck, SUITS, effectiveSuit, order, cardLabel, rankLabel } from './cards.js';
export function trainingQuestion(view) {
  if (!view.trump || !view.tricks.length || view.viewer < 0) return null;
  const suits = SUITS.filter((suit) => suit !== view.trump.suit);
  const suit = suits[(view.tricks.length - 1) % suits.length];
  const knownVoids = new Set();
  const evidence = [];
  for (const trick of view.tricks) {
    const led = effectiveSuit(trick.plays[0].cards[0], view.trump);
    if (led !== suit) continue;
    for (const play of trick.plays.slice(1)) {
      if (play.cards.filter((card) => effectiveSuit(card, view.trump) === suit).length < trick.plays[0].cards.length) {
        knownVoids.add(play.seat);
        evidence.push('第 ' + (trick.index + 1) + ' 墩，' + view.seats[play.seat].name + ' 没有跟足该门，说明跟完后已经断门。');
      }
    }
  }
  if (view.tricks.length % 2 === 1) {
    const names = [...knownVoids].sort().map((seat) => view.seats[seat].name);
    return { title: '记牌 · 断门', question: '第 ' + view.tricks.length + ' 墩后，根据跟牌可以确定谁已没有' + ({ S: '黑桃', H: '红桃', D: '方块', C: '梅花' })[suit] + '副牌？',
      options: [...view.seats.map((seat) => seat.name), '尚不能确定'],
      correct: names.length ? names : ['尚不能确定'], multiple: true,
      explanation: evidence.length ? [...new Set(evidence)].join(' ') : '目前的跟牌记录没有证明任何玩家已断这一门，不能把猜测当作事实。' };
  }
  const excluded = new Set([...view.tricks.flatMap((trick) => trick.plays.flatMap((play) => play.cards)), ...view.buriedKnown].map((card) => card.id));
  const remaining = makeDeck().filter((card) => effectiveSuit(card, view.trump) === suit && !excluded.has(card.id)).sort((a, b) => order(b, view.trump) - order(a, view.trump));
  if (!remaining.length) return null;
  const top = remaining[0];
  const ranks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].filter((rank) => rank !== view.trump.rank);
  const chosen = [...new Set([top.rank, ...ranks])].slice(0, 4).sort((a, b) => b - a);
  return { title: '记牌 · 大牌', question: '第 ' + view.tricks.length + ' 墩后，根据已出牌和你知道的底牌，' + ({ S: '黑桃', H: '红桃', D: '方块', C: '梅花' })[suit] + '副牌里尚未被排除的最大牌是什么？',
    options: chosen.map((rank) => cardLabel({ suit, rank })), correct: [cardLabel(top)], multiple: false,
    explanation: '目前仍有 ' + remaining.filter((card) => card.rank === top.rank).length + ' 张 ' + cardLabel(top) + ' 未被排除。两副牌要分别计数；未知底牌不能用来排除可能性。级牌 ' + rankLabel(view.trump.rank) + ' 属于主牌。' };
}
