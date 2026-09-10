import { makeDeck, effectiveSuit, faceKey, order, points } from './cards.js';
import { resolveTrick, components } from './rules.js';

// The only input is a seat observation. No engine state, policy or provider.
// Unlocated cards can be in ANY other hand or the unknown kitty.
export function publicPlays(view) {
  const history = view.history ?? (view.tricks || []).flatMap(trick => trick.plays);
  const seen = new Set(), plays = [];
  for (const play of [...history, ...(view.plays || [])]) {
    const cards = play.cards.filter(card => !seen.has(card.id));
    if (!cards.length) continue;
    cards.forEach(card => seen.add(card.id));
    plays.push({ seat: play.seat, cards });
  }
  return plays;
}

export function buildNotebook(view) {
  if (!view.trump) return null; // A provisional bid is not a settled effective suit.
  const trump = view.trump, seat = view.seat ?? view.viewer ?? -1;
  const history = publicPlays(view), played = history.flatMap(play => play.cards);
  const hand = view.hand || [], buried = view.buriedKnown || [];
  const ids = cards => new Set(cards.map(card => card.id));
  const playedIds = ids(played), handIds = ids(hand), buriedIds = ids(buried);
  const deck = makeDeck();
  const unplayed = deck.filter(card => !playedIds.has(card.id) && !buriedIds.has(card.id));
  const unlocated = unplayed.filter(card => !handIds.has(card.id));
  const countFaces = cards => {
    const faces = new Map();
    for (const card of cards) {
      const key = faceKey(card);
      if (!faces.has(key)) faces.set(key, [card.suit, card.rank, 0]);
      faces.get(key)[2]++;
    }
    return [...faces.values()].sort((a, b) => order({ suit: b[0], rank: b[1] }, trump) - order({ suit: a[0], rank: a[1] }, trump) || a[0].localeCompare(b[0]));
  };
  const top = cards => {
    if (!cards.length) return [];
    const highest = Math.max(...cards.map(card => order(card, trump)));
    return countFaces(cards.filter(card => order(card, trump) === highest));
  };
  const voids = [];
  // Four ordered plays form a trick, including a possible incomplete last trick.
  for (let start = 0; start < history.length; start += 4) {
    const lead = history[start], suit = effectiveSuit(lead.cards[0], trump);
    for (const play of history.slice(start + 1, start + 4)) {
      if (play.cards.filter(card => effectiveSuit(card, trump) === suit).length < lead.cards.length &&
          !voids.some(entry => entry.seat === play.seat && entry.suit === suit)) {
        voids.push({ seat: play.seat, suit, afterTrick: Math.floor(start / 4) + 1 });
      }
    }
  }
  const dealer = view.declSeat ?? view.dealer;
  const current = view.plays || [];
  const players = Array.from({ length: 4 }, (_, player) => {
    const own = history.filter(play => play.seat === player), leads = {}, wins = [];
    for (let start = 0; start < history.length; start += 4) {
      const trick = history.slice(start, start + 4);
      if (trick[0].seat === player) {
        const suit = effectiveSuit(trick[0].cards[0], trump);
        leads[suit] = (leads[suit] || 0) + 1;
      }
      if (trick.length === 4) { const result = resolveTrick(trick, trump); if (result.winner === player) wins.push(result); }
    }
    return { seat: player, remainingCards: view.handSizes?.[player] ?? null, leads,
      tricksWon: wins.length, pointsWon: wins.reduce((sum, win) => sum + win.points, 0),
      pointsPlayed: points(own.flatMap(play => play.cards)),
      lastPlay: own.length ? countFaces(own.at(-1).cards) : [] };
  });
  return {
    version: 1,
    basis: 'Public plays + own hand + own known burial. Unlocated includes the unknown kitty; it is not an opponent-hand count. Top cards are possibilities, not ownership claims. Voids are proved after that play.',
    partner: seat >= 0 ? (seat + 2) % 4 : null,
    role: seat < 0 || dealer < 0 ? null : dealer % 2 === seat % 2 ? 'defender' : 'attacker',
    attackPointsNeeded: Math.max(0, 80 - (view.attackPoints || 0)),
    playedPoints: points(played), knownBuriedPoints: buried.length ? points(buried) : null,
    jokers: [16, 15].map(rank => ({ rank, played: played.filter(card => card.rank === rank).length,
      held: hand.filter(card => card.rank === rank).length, buried: buried.filter(card => card.rank === rank).length,
      unlocated: unlocated.filter(card => card.rank === rank).length })),
    suits: ['T', 'S', 'H', 'D', 'C'].filter(suit => suit !== trump.suit).map(suit => {
      const inSuit = cards => cards.filter(card => effectiveSuit(card, trump) === suit);
      return { suit, held: inSuit(hand).length, played: inSuit(played).length,
        unlocated: inSuit(unlocated).length,
        topUnplayed: top(inSuit(unplayed)), topOutsideHand: top(inSuit(unlocated)),
        unlocatedFaces: countFaces(inSuit(unlocated)),
        ownPairs: components(inSuit(hand), trump).filter(part => part.type !== 'single').map(part => ({ type: part.type, cards: part.cards.map(card => card.id) })) };
    }),
    provenVoids: voids,
    publicPlayerHistory: players,
    currentTrick: current.length ? {
      winningSeat: resolveTrick(current, trump).winner,
      points: points(current.flatMap(play => play.cards)),
      seatsStillToPlay: Array.from({ length: 4 - current.length }, (_, i) => (current[0].seat + current.length + i) % 4),
    } : null,
  };
}
