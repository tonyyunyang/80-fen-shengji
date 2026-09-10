import { choosePeilian } from './peilian.js';
import { classify, legalFollow, resolveCards } from './rules.js';

// A transparent local reference candidate, never hidden information or an
// automatic replacement for the model's decision. Keep vendor access behind
// the same observation-only boundary used by normal Peilian seats.
export function buildAdvisorContext(view, moves, tool) {
  if (!['lead', 'follow', 'bury'].includes(view.phase)) return null;
  const action = choosePeilian(view, '', { deterministic: true });
  const cards = resolveCards(view.hand, action.cardIds);
  if (view.phase === 'bury' ? cards.length !== 8 : view.phase === 'lead' ? !classify(cards, view.trump) :
    !legalFollow(view.hand, cards, classify(view.plays[0].cards, view.trump), view.trump, view.rules)) {
    throw new Error('Peilian reference suggestion did not satisfy the acting observation');
  }
  let args = { card_ids: [...action.cardIds] };
  if (tool.name === 'play_move') {
    const id = moves.findIndex(ids => ids.length === action.cardIds.length && ids.every(id => action.cardIds.includes(id)));
    if (id < 0) throw new Error('Peilian reference suggestion was absent from the complete legal menu');
    args = { move_id: id };
  }
  return { version: 1, policy: 'peilian',
    basis: 'A reference suggestion from the preserved local Peilian policy using only this exact seat observation. No other hands, unknown kitty, shuffle seed or future plays are consulted. This is advice, not an enforced move or a guarantee of best play.',
    tool: { name: tool.name, arguments: args } };
}

export const ADVISOR_PROMPT = [
  'referenceAdvice is an explicitly supplied Peilian-policy candidate, computed from the same permitted information as you. You are playing with this advice; it is not a hidden-hand oracle.',
  'Use its exact tool arguments as your starting candidate. Prefer it unless you can identify a concrete team benefit for a different legal action from the visible facts. Compare both before deviating; a lower immediate pointsSpent alone is not a sufficient reason to dismantle control or a useful suit.',
  'A verified score threshold, banking disposable points in a secured team win, or preserving a necessary final-trick entry can justify another action. Uncertain future hands do not prove the reference wrong. The full action space remains available and the final choice is yours.',
].join('\n');
