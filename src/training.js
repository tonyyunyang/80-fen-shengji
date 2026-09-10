import { makeDeck, SUITS, effectiveSuit, order, cardLabel, rankLabel } from './cards.js';
export function trainingQuestion(view, locale = 'zh') {
  if (!view.trump || !view.tricks.length || view.viewer < 0) return null;
  const text = (zh, en) => locale === 'en' ? en : zh;
  const label = card => cardLabel(card, locale);
  const name = seat => {
    const original = view.seats[seat].name;
    return ['你', '南家', '东家', '北家', '西家', 'You', 'S', 'E', 'N', 'W'].includes(original) ?
      seat === view.viewer ? text('你', 'You') : text(['南家','东家','北家','西家'][seat], ['South','East','North','West'][seat]) : original;
  };
  if (view.score) {
    const captured = view.tricks.at(-1).winner % 2 !== view.dealer % 2;
    const protectedAnswer = text('庄家方赢了最后一墩，底牌不计入攻方得分。', 'Defenders won the last trick; the kitty adds no attacker points.');
    const capturedAnswer = text('攻方赢了最后一墩，底牌按最后领出张数的两倍计分。', 'Attackers won the last trick; kitty points use twice the final lead count.');
    return { title: text('复盘 · 最后一墩', 'Review · the final trick'),
      question: text('这一局的底牌是怎样计分的？', 'How was the kitty scored in this deal?'),
      options: [protectedAnswer, capturedAnswer], correct: [captured ? capturedAnswer : protectedAnswer], multiple: false,
      explanation: text('最后一墩由 ' + name(view.tricks.at(-1).winner) + ' 拿下。底牌 ' + view.score.kittyPoints + ' 分，本局计入攻方的底牌分为 ' + (captured ? view.score.kittyPoints * view.score.multiplier : 0) + '。',
        name(view.tricks.at(-1).winner) + ' took the final trick. The kitty held ' + view.score.kittyPoints + ' points and added ' + (captured ? view.score.kittyPoints * view.score.multiplier : 0) + ' attacker points.') };
  }
  const unknown = text('尚不能确定', 'Not yet proven');
  const suits = SUITS.filter(suit => suit !== view.trump.suit);
  const suit = suits[(view.tricks.length - 1) % suits.length];
  const suitName = text(({ S: '黑桃', H: '红桃', D: '方块', C: '梅花' })[suit], ({ S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' })[suit]);
  const knownVoids = new Set(), evidence = [];
  for (const trick of view.tricks) {
    if (effectiveSuit(trick.plays[0].cards[0], view.trump) !== suit) continue;
    for (const play of trick.plays.slice(1)) {
      if (play.cards.filter(card => effectiveSuit(card, view.trump) === suit).length < trick.plays[0].cards.length) {
        knownVoids.add(play.seat);
        evidence.push(text('第 ' + (trick.index + 1) + ' 墩，' + name(play.seat) + ' 没有跟足该门，说明跟完后已经断门。',
          'In trick ' + (trick.index + 1) + ', ' + name(play.seat) + ' could not fully follow suit and was void after playing.'));
      }
    }
  }
  if (view.tricks.length % 2 === 1) {
    const names = [...knownVoids].sort().map(name);
    return { title: text('记牌 · 断门', 'Memory · suit voids'),
      question: text('第 ' + view.tricks.length + ' 墩后，根据跟牌可以确定谁已没有' + suitName + '副牌？',
        'After trick ' + view.tricks.length + ', who is proven void in non-trump ' + suitName + '?'),
      options: [...view.seats.map((_, seat) => name(seat)), unknown], correct: names.length ? names : [unknown], multiple: true,
      explanation: evidence.length ? [...new Set(evidence)].join(' ') : text('目前的跟牌记录没有证明任何玩家已断这一门，不能把猜测当作事实。', 'No public follow has proved a void in this suit. An inference is not a fact.') };
  }
  const excluded = new Set([...view.tricks.flatMap(trick => trick.plays.flatMap(play => play.cards)), ...view.buriedKnown].map(card => card.id));
  const remaining = makeDeck().filter(card => effectiveSuit(card, view.trump) === suit && !excluded.has(card.id)).sort((a, b) => order(b, view.trump) - order(a, view.trump));
  if (!remaining.length) return null;
  const top = remaining[0];
  const ranks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].filter(rank => rank !== view.trump.rank);
  const chosen = [...new Set([top.rank, ...ranks])].slice(0, 4).sort((a, b) => b - a);
  const count = remaining.filter(card => card.rank === top.rank).length;
  return { title: text('记牌 · 大牌', 'Memory · top cards'),
    question: text('第 ' + view.tricks.length + ' 墩后，根据已出牌和你知道的底牌，' + suitName + '副牌里尚未被排除的最大牌是什么？',
      'After trick ' + view.tricks.length + ', what is the highest non-trump ' + suitName + ' face not excluded by played cards and your known burial?'),
    options: chosen.map(rank => label({ suit, rank })), correct: [label(top)], multiple: false,
    explanation: text('目前仍有 ' + count + ' 张 ' + label(top) + ' 未被排除。两副牌要分别计数；未知底牌不能用来排除可能性。级牌 ' + rankLabel(view.trump.rank) + ' 属于主牌。',
      count + (count === 1 ? ' copy of ' : ' copies of ') + label(top) + (count === 1 ? ' has' : ' have') + ' not been excluded. Count both decks. Unknown kitty cards remain possible. All level-' + rankLabel(view.trump.rank) + ' cards are trumps.') };
}
