import { SUITS, faceKey, effectiveSuit, order, points, cardPoints } from './cards.js';

export const RULESET_ID = 'shanghai-80fen-0.7.14-v1';
export const DEFAULT_RULES = Object.freeze({
  strictTractorFollow: true, partialTractorFollow: true,
  gates: [2, 5, 10, 13], fullRebel: 'off', speedRun: false,
  pointRebelThreshold: 15, trumpRebelThreshold: 3, maxRedeal: 3,
});
export function groups(cards) {
  const map = new Map();
  for (const card of cards) {
    if (!map.has(faceKey(card))) map.set(faceKey(card), []);
    map.get(faceKey(card)).push(card);
  }
  return [...map.values()];
}
export const pairCount = (cards) => groups(cards).reduce((sum, group) => sum + Math.floor(group.length / 2), 0);

// Equal-order pairs occupy separate layers, so an extra off-suit level pair cannot split a tractor.
export function components(cards, trump) {
  const sameFaces = groups(cards);
  const pairs = sameFaces.filter((g) => g.length === 2).sort((a, b) => order(a[0], trump) - order(b[0], trump));
  const layers = [];
  const rankCounts = new Map();
  for (const pair of pairs) {
    const rank = order(pair[0], trump);
    const layer = rankCounts.get(rank) || 0;
    rankCounts.set(rank, layer + 1);
    (layers[layer] ||= []).push(pair);
  }
  const result = [];
  for (const layer of layers) {
    let start = 0;
    while (start < layer.length) {
      let end = start + 1;
      while (end < layer.length && order(layer[end][0], trump) === order(layer[end - 1][0], trump) + 1) end++;
      const run = layer.slice(start, end);
      result.push({ type: run.length > 1 ? 'tractor' : 'pair', len: run.length, cards: run.flat(), top: order(run.at(-1)[0], trump) });
      start = end;
    }
  }
  for (const group of sameFaces) if (group.length === 1) result.push({ type: 'single', len: 1, cards: group, top: order(group[0], trump) });
  return result;
}
export function classify(cards, trump) {
  if (!cards.length) return null;
  const suit = effectiveSuit(cards[0], trump);
  if (!cards.every((card) => effectiveSuit(card, trump) === suit)) return null;
  const parts = components(cards, trump);
  return {
    type: parts.length === 1 ? parts[0].type : 'throw',
    len: parts.length === 1 ? parts[0].len : undefined,
    suit, top: Math.max(...parts.map((part) => part.top)), cards, parts,
  };
}
export function longestTractor(cards, trump) {
  return Math.max(0, ...components(cards, trump).filter((part) => part.type === 'tractor').map((part) => part.len));
}
export function resolveCards(hand, ids) {
  if (!Array.isArray(ids) || !ids.length || !ids.every(Number.isInteger) || new Set(ids).size !== ids.length) throw new Error('请选择不重复的手牌');
  const map = new Map(hand.map((card) => [card.id, card]));
  const selected = ids.map((id) => map.get(id));
  if (selected.some((card) => !card)) throw new Error('选中的牌不在当前手牌中');
  return selected;
}
export function followError(hand, selected, lead, trump, rules = DEFAULT_RULES) {
  if (selected.length !== lead.cards.length) return '请跟出 ' + lead.cards.length + ' 张牌';
  try { resolveCards(hand, selected.map((card) => card.id)); } catch (error) { return error.message; }
  const held = hand.filter((card) => effectiveSuit(card, trump) === lead.suit);
  const followed = selected.filter((card) => effectiveSuit(card, trump) === lead.suit);
  if (followed.length !== Math.min(lead.cards.length, held.length)) return '有领出花色时必须尽量跟足';
  const requiredPairs = Math.min(pairCount(lead.cards), pairCount(held));
  if (pairCount(followed) < requiredPairs) return '有对子时必须跟足对子';
  if (rules.strictTractorFollow && lead.type === 'tractor') {
    const longest = longestTractor(held, trump);
    const required = longest >= lead.len ? lead.len : rules.partialTractorFollow && longest >= 2 ? longest : 0;
    if (longestTractor(followed, trump) < required) return '必须跟出手中可用的拖拉机';
  }
  return null;
}
export const legalFollow = (hand, selected, lead, trump, rules) => !followError(hand, selected, lead, trump, rules);
export function safeFollow(hand, lead, trump, rules = DEFAULT_RULES) {
  const cheap = (a, b) => order(a, trump) - order(b, trump) || cardPoints(a) - cardPoints(b) || a.id - b.id;
  const suited = hand.filter((card) => effectiveSuit(card, trump) === lead.suit).sort(cheap);
  const selected = [];
  const add = (cards) => cards.forEach((card) => { if (!selected.some((c) => c.id === card.id)) selected.push(card); });
  const longest = longestTractor(suited, trump);
  const required = rules.strictTractorFollow && lead.type === 'tractor' ? (longest >= lead.len ? lead.len : rules.partialTractorFollow && longest >= 2 ? longest : 0) : 0;
  if (required) {
    const tractor = components(suited, trump).find((part) => part.type === 'tractor' && part.len >= required);
    add(tractor.cards.slice(0, required * 2));
  }
  const mustPair = Math.min(pairCount(lead.cards), pairCount(suited));
  for (const pair of groups(suited).filter((g) => g.length === 2)) {
    if (pairCount(selected) >= mustPair) break;
    add(pair);
  }
  for (const card of suited) {
    if (selected.length >= Math.min(suited.length, lead.cards.length)) break;
    add([card]);
  }
  for (const card of [...hand].sort((a, b) => cardPoints(a) - cardPoints(b) || cheap(a, b))) {
    if (selected.length >= lead.cards.length) break;
    add([card]);
  }
  if (followError(hand, selected, lead, trump, rules)) throw new Error('合法跟牌生成器不满足规则');
  return selected;
}
const signature = (shape) => shape.parts.map((part) => part.type + (part.type === 'tractor' ? part.len : '')).sort().join(',');
export function enumerateLegalFollows(hand, lead, trump, rules = DEFAULT_RULES, limit = 48, workLimit = 20000) {
  const count = lead.cards.length;
  if (count < 1 || count > hand.length) return [];
  let combinations = 1;
  for (let i = 1; i <= Math.min(count, hand.length - count); i++) {
    combinations = combinations * (hand.length - i + 1) / i;
    if (combinations > workLimit) return null;
  }
  const moves = [], chosen = [];
  let overflow = false;
  const walk = (start) => {
    if (overflow) return;
    if (chosen.length === count) {
      if (legalFollow(hand, chosen, lead, trump, rules)) {
        moves.push(chosen.map((card) => card.id));
        if (moves.length > limit) overflow = true;
      }
      return;
    }
    for (let i = start; i <= hand.length - (count - chosen.length); i++) {
      chosen.push(hand[i]); walk(i + 1); chosen.pop();
      if (overflow) break;
    }
  };
  walk(0);
  // Never return a truncated shortlist: null means use direct card IDs instead.
  return overflow ? null : moves;
}
export function resolveTrick(plays, trump) {
  const lead = classify(plays[0].cards, trump);
  let winner = plays[0].seat;
  let winning = lead;
  for (const play of plays.slice(1)) {
    const shape = classify(play.cards, trump);
    if (!shape || signature(shape) !== signature(lead)) continue;
    if ((shape.suit === winning.suit && shape.top > winning.top) || (shape.suit === 'T' && winning.suit !== 'T')) {
      winning = shape; winner = play.seat;
    }
  }
  return { winner, points: points(plays.flatMap((play) => play.cards)) };
}
export function adjudicateThrow(hands, seat, cards, trump) {
  const lead = classify(cards, trump);
  if (!lead || lead.type !== 'throw') return { cards, failed: false };
  const beatable = lead.parts.some((part) => hands.some((hand, other) => {
    if (other === seat) return false;
    const suited = hand.filter((card) => effectiveSuit(card, trump) === lead.suit);
    if (part.type === 'single') return suited.some((card) => order(card, trump) > part.top);
    return components(suited, trump).some((candidate) => candidate.type !== 'single' && candidate.top > part.top && (part.type === 'pair' || candidate.type === 'tractor' && candidate.len >= part.len));
  }));
  return beatable ? { cards: lead.parts.reduce((lowest, part) => part.top < lowest.top ? part : lowest).cards, failed: true } : { cards, failed: false };
}
export function declarationOptions(hand, rank, current, seat, rebelHappened = false) {
  const candidates = [];
  for (const suit of SUITS) {
    const count = hand.filter((card) => card.suit === suit && card.rank === rank).length;
    if (count) candidates.push({ id: suit + '1', suit, strength: 1 });
    if (count === 2) candidates.push({ id: suit + '2', suit, strength: 2 });
  }
  // The reference chooses the big-joker pair when both joker pairs are held.
  const jokerRank = [16, 15].find((r) => hand.filter((card) => card.rank === r).length === 2);
  if (jokerRank) candidates.push({ id: 'X' + (jokerRank - 12), suit: null, strength: jokerRank - 12 });
  return candidates.filter((next) => !current ||
    (current.seat !== seat && next.strength > current.strength) ||
    (current.seat === seat && current.strength === 1 && next.strength === 2 && current.suit === next.suit && !rebelHappened));
}
export function rebelEligible(hand, trump, rules) {
  return (rules.pointRebelThreshold > 0 && points(hand) <= rules.pointRebelThreshold) ||
    (rules.trumpRebelThreshold >= 0 && hand.filter((card) => effectiveSuit(card, trump) === 'T').length <= rules.trumpRebelThreshold);
}
export function scoreDeal(attackPoints, kitty, attackersLast, lastSize) {
  const kittyPoints = points(kitty);
  const multiplier = 2 * lastSize;
  const total = attackPoints + (attackersLast ? kittyPoints * multiplier : 0);
  return { attackPoints, kittyPoints, multiplier, total, attackersWin: total >= 80, levelsUp: total >= 80 ? Math.floor((total - 80) / 40) : total === 0 ? 3 : total < 40 ? 2 : 1 };
}
export function advanceMatch(match, dealer, score, rules) {
  const result = structuredClone(match);
  const defendingTeam = dealer % 2;
  const team = score.attackersWin ? 1 - defendingTeam : defendingTeam;
  if (!score.attackersWin) result.played[team] = Math.max(result.played[team], result.levels[team]);
  const from = result.levels[team];
  let next = from + score.levelsUp;
  result.gateHeld = null;
  if (rules.speedRun) next = score.levelsUp > 0 ? ([2, 5, 10, 13, 14].find((rank) => rank > from) || 15) : from;
  else {
    next = rules.gates.find((gate) => gate > from && gate < next) || next;
    if (score.levelsUp && rules.gates.includes(from) && result.played[team] < from) { next = from; result.gateHeld = from; }
  }
  result.levels[team] = next;
  result.dealer = (dealer + (score.attackersWin ? 1 : 2)) % 4;
  result.winner = result.levels.findIndex((rank) => rank > 14);
  result.round += 1;
  return result;
}
