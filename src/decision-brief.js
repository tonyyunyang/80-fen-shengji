import { cardLabel, effectiveSuit, order } from './cards.js';
import { buildStrategyContext } from './strategy-context.js';

// Reorganize permitted facts around each action. No new source of information,
// ownership inference, recommendation or reduction of the complete follow menu.
export function decisionFirstObservation(view, compact, moves) {
  const context = buildStrategyContext(view, moves, compact.notebook);
  const team = compact.partnership;
  const byId = new Map(view.hand.map(card => [card.id, card]));
  const result = {
    v: compact.v, phase: view.phase,
    partnership: {
      you: team.you, partner: team.partner, opponents: team.opponents, role: team.role,
      dealer: team.dealer, objective: team.objective, scoreRace: team.scoreRace,
      seats: team.seats, trick: team.trick,
    },
    trump: view.trump, level: view.trumpRank,
    hand: compact.hand,
    handLabels: view.hand.map(card => [card.id, cardLabel(card)]),
    handShape: context?.handShape ?? null,
    suitControl: context?.suitControl ?? null,
    trick: compact.trick, history: compact.history,
    publicMemory: {
      unlocatedFaces: compact.notebook?.suits.map(suit => ({ suit: suit.suit, faces: suit.unlocatedFaces })) ?? null,
      revealedCards: team.unplayedRevealedCards,
      meaning: 'Unlocated cards include the unknown kitty; their owners are unknown. Declared dealer cards may have been buried. A higher unlocated face is a possibility, not an opponent holding.',
    },
    knownKitty: compact.knownKitty,
    actionContext: compact.actionContext,
  };
  if (compact.mustFollow) result.mustFollow = compact.mustFollow;
  if (moves?.length) {
    result.legalMoves = moves.map((ids, id) => {
      const facts = context.moves[id], certain = team.certainMoveOutcomes[id];
      return {
        id, card_ids: ids, cards: facts.cards,
        winnerSoFar: facts.winnerSoFar, teamOutcome: facts.teamOutcome,
        overtakesPartner: facts.overtakesPartner, pointsOnTableAfter: facts.visiblePointsAfterMove,
        pointsSpent: facts.pointsSpent, trumpsSpent: facts.trumpsSpent,
        highTrumpsSpent: facts.highTrumpsSpent, trumpOrdersSpent: facts.trumpOrdersSpent,
        pairsBroken: facts.pairsBroken, pairsRemaining: facts.pairsRemaining,
        longestTractorRemaining: facts.longestTractorPairsRemaining,
        remainingSuitCounts: facts.remainingSuitCounts,
        offSuitSourceLengths: facts.offSuitSourceLengths,
        attackerPointsAddedNow: certain.attackerPointsAddedNow,
        clinchesAttackerTakeover: certain.clinchesAttackerTakeover,
        // Higher order only compares cards of the SAME effective suit.
        orders: ids.map(cardId => { const card = byId.get(cardId); return [effectiveSuit(card, view.trump), order(card, view.trump)]; }),
      };
    });
    result.moveFacts = {
      suitOrder: context.suitOrder, finalTrick: context.table.finalTrick,
      kittyMultiplierIfFinal: context.table.kittyMultiplierIfFinal,
      knownKittyPoints: context.table.knownKittyPoints,
      meaning: 'secured: no remaining opponent can change the winning team; lost: no remaining ally can recover; unsettled: later replies may change the winner. Remaining card points are unknown. Larger order wins only within the same effective suit; equality loses to the earlier play.',
    };
  }
  if (compact.referenceAdvice) result.referenceAdvice = compact.referenceAdvice;
  if (!['lead','follow'].includes(view.phase)) {
    Object.assign(result, {
      levels: compact.levels, passedLevels: compact.passedLevels, gates: compact.gates,
      dealerKnown: compact.dealerKnown, previousDealer: compact.previousDealer,
      firstTaker: compact.firstTaker, dealt: compact.dealt, closing: compact.closing,
      choices: compact.choices, declaration: compact.declaration, declarations: compact.declarations,
    });
  }
  return result;
}

export const DECISION_FIRST_PROMPT = [
  'Win for YOUR PARTNERSHIP. Read partnership first: your opposite seat is your teammate; the adjacent seats are opponents. At exactly 80 attackers win. Individual trick count and agreement with a practice bot are not objectives.',
  'Use the supplied legalMoves as one joined decision table: each row contains its exact arguments, readable cards, public winner, certain team outcome, point cost and retained structures. Every legal combination remains available. If no menu exists, the hand groups and exact card-ID contract define your action.',
  'First take a certain team win or avoid a certain loss at the 80-point threshold if a legal choice allows it. Otherwise consider the whole deal: points captured, useful trump control, side-suit winners, partner entries and the last trick/kitty.',
  'On a secured team trick, cash expendable points without needlessly spending high controls or breaking useful pairs. Do not overtake a secured partner just to win personally. On a lost trick, avoid both unneeded points and destroying future control: sacrificing a small point card can be better than wasting a level card or joker that also loses.',
  'When unsettled, check which opponents still act and their proven voids before feeding points or spending a winner. A void allows a possible ruff, but does not prove they hold trump. Do not treat the winner so far as a guaranteed result.',
  'On lead, compare side-suit winners and useful pairs/tractors with a trump draw serving a concrete plan. A long suit can be valuable once higher outside cards or opposing trumps are exhausted. Keep a way to regain the lead for the ending. Shorten weak side suits when discarding; do not dismantle a strong long suit merely to save an immediate five points.',
  'referenceAdvice, when present, is one candidate from the practice policy with the same permitted information. Compare it with alternatives by team outcome; it is neither optimal by definition nor a target to imitate. The final action is yours.',
  'Unlocated cards may be in ANY other hand or the unknown kitty. Never assume a sampled or guessed owner. No hidden cards, shuffle seed or quiz answers are supplied.',
  'Return exactly one supplied action tool promptly, without commentary. Keep within the shared 12-second decision deadline.',
].join('\n');
