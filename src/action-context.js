import { cardLabel, effectiveSuit, order, points } from './cards.js';
import { components } from './rules.js';

export function buildActionContext(view, moves, tool) {
  const result = { version: 1, phase: view.phase, tool: tool.name };
  if (tool.name === 'play_move') {
    result.argument = 'move_id';
    result.allowedMoveIds = moves.map((_, id) => id);
    result.instruction = 'Return play_move with one integer move_id from allowedMoveIds. This is a menu ID, not a physical card ID.';
  } else if (tool.name === 'declare_trump') {
    result.argument = 'choice';
    result.allowedChoices = ['pass', ...(view.options || []).map(option => option.id)];
    result.instruction = 'Return declare_trump with one allowed choice string.';
  } else if (tool.name === 'request_redeal') {
    result.argument = 'accept';
    result.instruction = 'Return request_redeal with a boolean accept.';
  } else {
    result.argument = 'card_ids';
    result.allowedCardIds = view.hand.map(card => card.id);
    result.requiredCount = view.phase === 'bury' ? 8 : view.phase === 'follow' ? view.plays[0].cards.length : null;
    result.instruction = `Return ${tool.name} with card_ids containing ${result.requiredCount === null ? 'one or more' : 'exactly ' + result.requiredCount} distinct PHYSICAL card IDs from allowedCardIds. No move_id exists in this request.`;
    if (view.trump) {
      result.handGroups = ['T','S','H','D','C'].filter(suit => suit !== view.trump.suit).map(suit => {
        const cards = view.hand.filter(card => effectiveSuit(card, view.trump) === suit);
        return { effectiveSuit: suit, cards: cards.map(card => ({ id: card.id, face: cardLabel(card), order: order(card, view.trump), points: points([card]) })),
          structures: components(cards, view.trump).map(part => ({ type: part.type, card_ids: part.cards.map(card => card.id) })) };
      }).filter(group => group.cards.length);
      result.groupMeaning = 'These groups contain only your hand. T includes every joker, level card and trump-suit card, regardless of printed suit. Structures are hand-building blocks, not a complete lead menu. A lead must use one effective-suit group; an attempted throw still requires engine adjudication.';
    }
  }
  return result;
}

export function constrainToolToObservation(tool, view, moves) {
  const bounded = structuredClone(tool);
  if (bounded.name === 'play_move') bounded.parameters.properties.move_id.enum = moves.map((_, id) => id);
  if (bounded.parameters.properties.card_ids) {
    const cards = bounded.parameters.properties.card_ids;
    cards.items.enum = view.hand.map(card => card.id);
    if (view.phase === 'follow') cards.minItems = cards.maxItems = view.plays[0].cards.length;
  }
  if (bounded.name === 'declare_trump') bounded.parameters.properties.choice.enum = ['pass', ...(view.options || []).map(option => option.id)];
  return bounded;
}
