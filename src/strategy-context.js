import { cardLabel, effectiveSuit, order, points } from './cards.js';
import { publicPlays } from './notebook.js';
import { buildDecisionContext } from './decision-context.js';

// These are public deductions, not a policy recommendation or a sampled hand.
export function buildStrategyContext(view, legalMoves, notebook) {
  const context = buildDecisionContext(view, legalMoves, notebook);
  if (!context) return null;
  context.version = 2;
  const { hand, trump, seat } = view;
  const suitOrder = context.handShape.map(row => row.suit);
  const allPlayed = new Set(publicPlays(view).flatMap(play => play.cards).map(card => card.id));
  const held = new Set(hand.map(card => card.id));
  const buried = new Set((view.buriedKnown || []).map(card => card.id));
  const shown = new Map();
  for (const declaration of view.declarations || []) {
    for (const card of declaration.cards || []) {
      if (allPlayed.has(card.id) || buried.has(card.id)) continue;
      const dealerCanHaveBuried = declaration.seat === view.declSeat && declaration.seat !== seat;
      shown.set(card.id, { card: [card.id, card.suit, card.rank], seat: declaration.seat,
        location: held.has(card.id) || !dealerCanHaveBuried ? 'hand' : 'dealer-hand-or-kitty' });
    }
  }
  context.publicDeclarationCards = [...shown.values()];
  context.suitOrder = suitOrder;
  context.scoreRace = {
    role: notebook?.role ?? null,
    attackPoints: view.attackPoints || 0,
    pointsToTakeover: Math.max(0, 80 - (view.attackPoints || 0)),
    attackersAlreadyReached80: (view.attackPoints || 0) >= 80,
    nextAttackerThreshold: (view.attackPoints || 0) < 80 ? 80 : 80 + (Math.floor(((view.attackPoints || 0) - 80) / 40) + 1) * 40,
  };
  if (!context.moves?.length) return context;
  const after = context.table.seatsAfterThisPlay;
  const allyRemains = after.some(player => player % 2 === seat % 2);
  const opponentRemains = after.some(player => player % 2 !== seat % 2);
  const cardsById = new Map(hand.map(card => [card.id, card]));
  context.moves = context.moves.map(move => {
    const cards = legalMoves[move.id].map(id => cardsById.get(id));
    const used = new Set(legalMoves[move.id]);
    const remaining = hand.filter(card => !used.has(card.id));
    const teamOutcome = move.teamWinningSoFar && !opponentRemains ? 'secured' : !move.teamWinningSoFar && !allyRemains ? 'lost' : 'unsettled';
    const offSuitCards = cards.filter(card => effectiveSuit(card, trump) !== context.table.ledSuit);
    return { ...move, cards: cards.map(card => cardLabel(card)).join(' '), teamOutcome,
      visiblePointsAfterMove: context.table.pointsOnTable + points(cards),
      highTrumpsSpent: cards.filter(card => effectiveSuit(card, trump) === 'T' && order(card, trump) >= 12).length,
      trumpOrdersSpent: cards.filter(card => effectiveSuit(card, trump) === 'T').map(card => order(card, trump)).sort((a, b) => b - a),
      offSuitSourceLengths: offSuitCards.map(card => context.handShape.find(suit => suit.suit === effectiveSuit(card, trump)).cards),
      remainingSuitCounts: suitOrder.map(suit => remaining.filter(card => effectiveSuit(card, trump) === suit).length) };
  });
  context.table.allLegalMovesLose = context.moves.every(move => move.teamOutcome === 'lost');
  context.table.hasSecuredTeamWin = context.moves.some(move => move.teamOutcome === 'secured');
  const equalMinimum = (rows, value) => {
    if (!rows.length) return [];
    const least = Math.min(...rows.map(value));
    return rows.filter(move => value(move) === least).map(move => move.id);
  };
  const secured = context.moves.filter(move => move.teamOutcome === 'secured');
  const offSuit = context.moves.filter(move => move.offSuitSourceLengths.length);
  context.comparisonSets = {
    leastHighTrumpsSpent: equalMinimum(context.moves, move => move.highTrumpsSpent),
    leastPairsBroken: equalMinimum(context.moves, move => move.pairsBroken),
    mostVisiblePointsWhenSecured: equalMinimum(secured, move => -move.visiblePointsAfterMove),
    shortestOffSuitSources: equalMinimum(offSuit, move => Math.max(...move.offSuitSourceLengths)),
  };
  const describe = ids => ids.length > 8 ? 'IDs ' + ids.join(', ') + ' (see the full move facts)' : ids.map(id => `${id} (${context.moves.find(move => move.id === id).cards})`).join(', ');
  const brief = [];
  if (context.table.allLegalMovesLose) brief.push('Your team cannot recover this trick with any legal move. Minimise damage to future control; compare conceding points with spending level cards/jokers.');
  if (context.comparisonSets.leastHighTrumpsSpent.length < context.moves.length) brief.push('Fewest level cards/jokers spent: ' + describe(context.comparisonSets.leastHighTrumpsSpent) + '.');
  if (secured.length) brief.push('Most visible points in a secured team win: ' + describe(context.comparisonSets.mostVisiblePointsWhenSecured) + '. Check control/structure cost before banking them.');
  if (offSuit.length && context.comparisonSets.shortestOffSuitSources.length < offSuit.length) brief.push('Off-suit discards from the shortest held suit(s): ' + describe(context.comparisonSets.shortestOffSuitSources) + '. Compare suit quality before breaking a strong long suit.');
  context.brief = brief.join(' ');
  context.comparisonMeaning = 'Comparison sets contain all ties for the named exact statistic. They are aids to comparison, not a replacement legal menu, recommended action or hidden-hand estimate.';
  context.outcomeMeaning = 'secured: no remaining opponent can change the winning team; lost: no remaining ally can recover this trick; unsettled: outcome depends on cards still to be played. Future card points are not included in visiblePointsAfterMove. remainingSuitCounts follows suitOrder. High trumps are level cards and jokers, not a score recommendation.';
  return context;
}
