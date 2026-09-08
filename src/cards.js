export const SUITS = ['S', 'H', 'D', 'C'];
export const SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣', X: '王', T: '主' };
export const rankLabel = (rank) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '小王', 16: '大王' })[rank] || String(rank);

export function makeDeck() {
  return Array.from({ length: 108 }, (_, id) => {
    const face = id % 54;
    return { id, suit: face < 52 ? SUITS[Math.floor(face / 13)] : 'X', rank: face < 52 ? face % 13 + 2 : face - 37 };
  });
}
export const faceKey = (card) => card.suit + card.rank;
export const cardLabel = (card) => card.suit === 'X' ? rankLabel(card.rank) : SYMBOLS[card.suit] + rankLabel(card.rank);
export const cardPoints = (card) => card.rank === 5 ? 5 : [10, 13].includes(card.rank) ? 10 : 0;
export const points = (cards) => cards.reduce((total, card) => total + cardPoints(card), 0);
export function randomSource(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
export function shuffle(cards, random) {
  const result = [...cards];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
export function cutFirst(seed) {
  const cards = shuffle(makeDeck(), randomSource(seed ^ 0x51ed270b)).slice(0, 4);
  const weight = (card) => card.rank * 10 + ({ S: 3, H: 2, C: 1, D: 0, X: 4 })[card.suit];
  return { cards, seat: cards.reduce((best, card, seat) => weight(card) > weight(cards[best]) ? seat : best, 0) };
}
export function effectiveSuit(card, trump) {
  return card.suit === 'X' || card.rank === trump.rank || card.suit === trump.suit ? 'T' : card.suit;
}
export function order(card, trump) {
  if (card.rank >= 15) return card.rank - 1;
  if (card.rank === trump.rank) return !trump.suit || card.suit === trump.suit ? 13 : 12;
  return card.rank - 2 - Number(card.rank > trump.rank);
}
export function sortedHand(cards, trump) {
  const groups = ['T', 'S', 'H', 'C', 'D'];
  return [...cards].sort((a, b) => groups.indexOf(effectiveSuit(a, trump)) - groups.indexOf(effectiveSuit(b, trump)) || order(b, trump) - order(a, trump) || a.suit.localeCompare(b.suit) || a.id - b.id);
}
