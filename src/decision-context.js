import { effectiveSuit, faceKey, order, points } from './cards.js';
import { longestTractor, resolveTrick } from './rules.js';

const counts = cards => {
  const result = new Map();
  for (const card of cards) result.set(faceKey(card), (result.get(faceKey(card)) || 0) + 1);
  return result;
};
function shape(cards, trump) {
  return ['T', 'S', 'H', 'D', 'C'].filter(suit => suit !== trump.suit).map(suit => {
    const held = cards.filter(card => effectiveSuit(card, trump) === suit);
    return { suit, cards: held.length, points: points(held),
      pairs: [...counts(held).values()].filter(count => count === 2).length,
      longestTractorPairs: longestTractor(held, trump) };
  });
}

// Accept only the same seat observation already sent to the provider. This
// module cannot inspect a state, shuffle, opponents' hands or private quizzes.
export function buildDecisionContext(view, legalMoves, notebook) {
  if (!view.trump || !['lead', 'follow', 'bury'].includes(view.phase)) return null;
  const trump = view.trump, hand = view.hand || [], seat = view.seat;
  const current = view.plays || [], partner = (seat + 2) % 4;
  const beforeWinner = current.length ? resolveTrick(current, trump).winner : null;
  const leadCount = current[0]?.cards.length || 0;
  const ledSuit = current.length ? effectiveSuit(current[0].cards[0], trump) : null;
  const remainingSeats = current.length ? Array.from({ length: Math.max(0, 3 - current.length) }, (_, i) => (seat + i + 1) % 4) : [];
  const ownCounts = counts(hand);
  const result = {
    version: 1,
    basis: 'Own hand and public observation only. Winners are computed only against plays already on the table. Remaining opponents may overtake or ruff. No ownership or win probabilities are inferred.',
    handShape: shape(hand, trump),
    suitControl: (notebook?.suits || []).map(suit => {
      const held = hand.filter(card => effectiveSuit(card, trump) === suit.suit);
      const possibleOutside = suit.unlocatedFaces || [];
      const bestHeld = held.length ? Math.max(...held.map(card => order(card, trump))) : null;
      return { suit: suit.suit,
        higherUnlocatedCopies: bestHeld === null ? null : possibleOutside.reduce((sum, [suit, rank, copies]) => sum + (order({ suit, rank }, trump) > bestHeld ? copies : 0), 0),
        tiedUnlocatedCopies: bestHeld === null ? null : possibleOutside.reduce((sum, [suit, rank, copies]) => sum + (order({ suit, rank }, trump) === bestHeld ? copies : 0), 0) };
    }),
    table: current.length ? {
      ledSuit, cardsRequired: leadCount, winnerSoFar: beforeWinner,
      partnerWinningSoFar: beforeWinner === partner, pointsOnTable: points(current.flatMap(play => play.cards)),
      seatsAfterThisPlay: remainingSeats,
      opponentsAfterThisPlay: remainingSeats.filter(player => player % 2 !== seat % 2),
      provenVoidOpponentsAfterThisPlay: remainingSeats.filter(player => player % 2 !== seat % 2 && notebook?.provenVoids.some(voidEntry => voidEntry.seat === player && voidEntry.suit === ledSuit)),
      finalTrick: view.phase === 'follow' && hand.length === leadCount,
      kittyMultiplierIfFinal: 2 * leadCount,
      knownKittyPoints: view.buriedKnown?.length ? points(view.buriedKnown) : null,
    } : null,
  };
  if (view.phase === 'follow' && legalMoves?.length) {
    const cardsById = new Map(hand.map(card => [card.id, card]));
    result.moves = legalMoves.map((ids, id) => {
      const chosen = ids.map(cardId => cardsById.get(cardId));
      if (chosen.some(card => !card)) throw new Error('Legal menu contained a card outside the acting hand');
      const used = new Set(ids), remaining = hand.filter(card => !used.has(card.id)), remainingCounts = counts(remaining);
      const winner = resolveTrick([...current, { seat, cards: chosen }], trump).winner;
      return { id, pointsSpent: points(chosen), trumpsSpent: chosen.filter(card => effectiveSuit(card, trump) === 'T').length,
        winnerSoFar: winner, teamWinningSoFar: winner % 2 === seat % 2,
        overtakesPartner: beforeWinner === partner && winner === seat,
        pairsBroken: [...ownCounts].filter(([face, count]) => count === 2 && remainingCounts.get(face) === 1).length,
        pairsRemaining: [...remainingCounts.values()].filter(count => count === 2).length,
        longestTractorPairsRemaining: Math.max(0, ...shape(remaining, trump).map(suit => suit.longestTractorPairs)) };
    });
  }
  return result;
}
