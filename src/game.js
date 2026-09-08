import { makeDeck, shuffle, randomSource, cutFirst, effectiveSuit, sortedHand } from './cards.js';
import { DEFAULT_RULES, RULESET_ID, declarationOptions, resolveCards, classify, followError, adjudicateThrow, resolveTrick, scoreDeal, advanceMatch, rebelEligible, safeFollow } from './rules.js';

const physicalCards = makeDeck();
const emit = (state, type, detail = {}, audience = 'public') => state.events.push({ seq: state.events.length, deal: state.attempts, type, ...detail, audience });
const rankFor = (state, seat) => state.dealerKnown ? state.trumpRank : state.match.levels[seat % 2];
function pending(state, seat, phase, options = null) {
  state.pending = { id: state.id + ':' + (++state.decisionNumber), version: state.version, seat, phase, options };
}
export function createGame({ id = 'test', seed = 1, seats = [], rules = {}, dealing = 'ordered' } = {}) {
  if (seats.length !== 4) throw new Error('牌桌必须恰好有四个座位');
  const merged = { ...DEFAULT_RULES, ...rules, gates: [...(rules.gates || DEFAULT_RULES.gates)].sort((a, b) => a - b) };
  const state = {
    id, seed, dealing, ruleset: RULESET_ID, rules: merged, seats: structuredClone(seats),
    match: { levels: [2, 2], played: [-1, -1], dealer: -1, round: 0, winner: -1 },
    version: 0, decisionNumber: 0, events: [], rounds: [], pending: null,
    attempts: 0, redeals: 0, forcedPasses: 0,
  };
  beginDeal(state);
  return automatic(state);
}
function beginDeal(state, scramble = false) {
  state.attempts++;
  const randomSeed = (state.seed + Math.imul(state.attempts, 0x9e3779b9)) >>> 0;
  state.dealerKnown = state.match.dealer >= 0 && !scramble;
  const cut = cutFirst(randomSeed);
  state.first = state.dealerKnown ? state.match.dealer : cut.seat;
  state.deck = shuffle(makeDeck(), randomSource(randomSeed));
  state.hands = [[], [], [], []]; state.kitty = []; state.captured = [[], []];
  state.dealt = 0; state.declaration = null; state.rebelHappened = false;
  state.declarationRevision = 0; state.drawSeat = null;
  state.trumpRank = state.match.levels[(state.dealerKnown ? state.match.dealer : state.first) % 2];
  state.trump = null; state.dealer = state.dealerKnown ? state.match.dealer : -1;
  state.plays = []; state.tricks = []; state.attackPoints = 0; state.score = null;
  state.closingIndex = 0; state.closingChanged = false; state.rebelIndex = 0;
  state.phase = 'dealing'; state.pending = null;
  emit(state, 'deal_started', { round: state.match.round + 1, first: state.first, levels: [...state.match.levels], redeals: state.redeals, dealing: state.dealing || 'ordered' });
  if (!state.dealerKnown) emit(state, 'cut', { cards: cut.cards, first: cut.seat });
}
function settleTrump(state) {
  state.trump = { rank: state.trumpRank, suit: state.declaration?.suit ?? null };
  state.dealer = state.dealerKnown ? state.match.dealer : state.declaration?.seat ?? state.first;
  state.phase = 'rebel';
  emit(state, 'trump_set', { trump: state.trump, dealer: state.dealer });
}
export function automatic(state) {
  while (!state.pending) {
    if (isBidding(state)) break;
    if (state.phase === 'dealing') {
      if (state.dealt === 100) { state.phase = 'closing'; continue; }
      const seat = (state.first + state.dealt) % 4;
      const card = state.deck.shift();
      state.hands[seat].push(card); state.dealt++;
      emit(state, 'draw', { seat, card, dealt: state.dealt }, seat);
      const options = declarationOptions(state.hands[seat], rankFor(state, seat), state.declaration, seat, state.rebelHappened);
      if (options.length) pending(state, seat, 'declare', options);
      else state.forcedPasses++;
    } else if (state.phase === 'closing') {
      if (state.closingIndex && state.closingIndex % 4 === 0) {
        if (!state.closingChanged || state.closingIndex >= 16) { settleTrump(state); continue; }
        state.closingChanged = false;
      }
      const seat = (state.first + state.closingIndex) % 4;
      state.closingIndex++;
      const options = declarationOptions(state.hands[seat], rankFor(state, seat), state.declaration, seat, state.rebelHappened);
      if (options.length) pending(state, seat, 'declare', options);
      else state.forcedPasses++;
    } else if (state.phase === 'rebel') {
      if (state.rules.fullRebel === 'off' || state.redeals >= state.rules.maxRedeal || state.rebelIndex === 4) {
        state.hands[state.dealer].push(...state.deck); state.deck = [];
        state.phase = 'bury';
        pending(state, state.dealer, 'bury');
      } else {
        const seat = (state.dealer + 1 + state.rebelIndex++) % 4;
        if (seat % 2 !== state.dealer % 2 && rebelEligible(state.hands[seat], state.trump, state.rules)) pending(state, seat, 'rebel');
      }
    } else if (state.phase === 'play') {
      const seat = (state.leader + state.plays.length) % 4;
      pending(state, seat, state.plays.length ? 'follow' : 'lead');
    } else break;
  }
  return state;
}
export const isBidding = (state) => state?.dealing === 'continuous' && ['dealing', 'closing'].includes(state.phase);
export function drawCard(state) {
  if (!isBidding(state) || state.phase !== 'dealing' || state.dealt >= 100) throw new Error('当前不能发牌');
  const next = structuredClone(state), seat = (next.first + next.dealt) % 4;
  const card = next.deck.shift(); next.hands[seat].push(card); next.dealt++; next.version++; next.drawSeat = seat;
  emit(next, 'draw', { seat, card, dealt: next.dealt }, seat);
  if (!declarationOptions(next.hands[seat], rankFor(next, seat), next.declaration, seat, next.rebelHappened).length) next.forcedPasses++;
  if (next.dealt === 100) { next.phase = 'closing'; emit(next, 'dealing_complete'); }
  return next;
}
function recordDeclaration(state, seat, option) {
  state.trumpRank = rankFor(state, seat);
  state.declaration = { seat, suit: option.suit, strength: option.strength };
  state.declarationRevision = (state.declarationRevision || 0) + 1;
  if (option.strength >= 3) state.rebelHappened = true;
  const rank = option.strength >= 3 ? option.strength + 12 : state.trumpRank;
  const shown = state.hands[seat].filter((card) => card.rank === rank && (option.suit ? card.suit === option.suit : card.suit === 'X')).slice(0, option.strength >= 2 ? 2 : 1);
  emit(state, 'declaration', { ...state.declaration, cards: shown });
}
export function applyBid(state, { gameId, epoch, seat, handCount, choice, source = 'human', decisionId }, offeredChoices = null) {
  const stale = () => Object.assign(new Error('这次亮主机会已过期'), { code: 'SUPERSEDED_BID' });
  if (!isBidding(state) || gameId !== state.id || epoch !== state.attempts) throw stale();
  if (!Number.isInteger(seat) || seat < 0 || seat > 3 || !Number.isInteger(handCount) || handCount < 0 || handCount > state.hands[seat].length) throw stale();
  if (typeof choice !== 'string' || offeredChoices && choice !== 'pass' && !offeredChoices.includes(choice)) throw new Error('亮主选择不在原始观察提供的选项中');
  if (choice === 'pass') return state; // Private silence: no event, version change, or public side effect.
  const hand = state.hands[seat].slice(0, handCount);
  const option = declarationOptions(hand, rankFor(state, seat), state.declaration, seat, state.rebelHappened).find((option) => option.id === choice);
  if (!option) throw stale();
  const next = structuredClone(state); next.version++;
  recordDeclaration(next, seat, option);
  next.lastAction = { seat, phase: 'declare', source };
  emit(next, 'decision_applied', { ...next.lastAction, decisionId, version: next.version, requested: { type: 'declare', choice } }, 'after_deal');
  return next;
}
export function closeBidding(state) {
  if (!isBidding(state) || state.phase !== 'closing') throw new Error('发牌尚未结束');
  const next = structuredClone(state); next.version++;
  settleTrump(next);
  return automatic(next);
}
export function applyAction(state, envelope) {
  const decision = state.pending;
  if (!decision || envelope.decisionId !== decision.id || envelope.version !== state.version || envelope.seat !== decision.seat) throw new Error('STALE_DECISION: 牌局已变化，请刷新后操作');
  const action = envelope.action;
  if (!action || typeof action !== 'object') throw new Error('缺少动作');
  // Validate everything on a clone: rejected inputs leave the original state untouched.
  const next = structuredClone(state);
  const seat = decision.seat;
  next.version++; next.pending = null;
  if (decision.phase === 'declare') {
    if (action.type !== 'declare' || typeof action.choice !== 'string') throw new Error('需要亮主或不亮的选择');
    if (action.choice !== 'pass') {
      const option = decision.options.find((item) => item.id === action.choice);
      if (!option) throw new Error('当前不能这样亮主');
      recordDeclaration(next, seat, option);
      if (next.phase === 'closing') next.closingChanged = true;
    } else emit(next, 'pass', { seat, stage: next.phase });
  } else if (decision.phase === 'rebel') {
    if (action.type !== 'rebel' || typeof action.accept !== 'boolean') throw new Error('请选择是否重新发牌');
    emit(next, 'rebel_choice', { seat, accept: action.accept });
    if (action.accept) { next.redeals++; beginDeal(next, next.rules.fullRebel === 'scramble'); }
  } else if (decision.phase === 'bury') {
    if (action.type !== 'bury') throw new Error('需要扣底动作');
    const cards = resolveCards(next.hands[seat], action.cardIds);
    if (cards.length !== 8) throw new Error('必须恰好扣八张底牌');
    next.kitty = cards;
    const ids = new Set(action.cardIds);
    next.hands[seat] = next.hands[seat].filter((card) => !ids.has(card.id));
    next.phase = 'play'; next.leader = next.dealer;
    emit(next, 'buried', { seat, cards }, seat);
  } else {
    if (action.type !== 'play') throw new Error('需要出牌动作');
    let cards = resolveCards(next.hands[seat], action.cardIds);
    if (!next.plays.length) {
      const shape = classify(cards, next.trump);
      if (!shape) throw new Error('领出的牌必须属于同一有效花色');
      const result = adjudicateThrow(next.hands, seat, cards, next.trump);
      if (result.failed) emit(next, 'throw_failed', { seat, proposed: cards, forced: result.cards });
      cards = result.cards;
    } else {
      const error = followError(next.hands[seat], cards, classify(next.plays[0].cards, next.trump), next.trump, next.rules);
      if (error) throw new Error(error);
    }
    const ids = new Set(cards.map((card) => card.id));
    next.hands[seat] = next.hands[seat].filter((card) => !ids.has(card.id));
    next.plays.push({ seat, cards });
    emit(next, 'play', { seat, cards, trick: next.tricks.length });
    if (next.plays.length === 4) {
      const result = resolveTrick(next.plays, next.trump);
      next.captured[result.winner % 2].push(...next.plays.flatMap((play) => play.cards));
      if (result.winner % 2 !== next.dealer % 2) next.attackPoints += result.points;
      const trick = { index: next.tricks.length, plays: next.plays, ...result };
      next.tricks.push(trick);
      next.leader = result.winner; next.plays = [];
      emit(next, 'trick', { index: trick.index, winner: result.winner, points: result.points });
      if (next.hands.every((hand) => hand.length === 0)) {
        next.completedDealEpoch = next.attempts;
        next.score = scoreDeal(next.attackPoints, next.kitty, result.winner % 2 !== next.dealer % 2, trick.plays[0].cards.length);
        next.match = advanceMatch(next.match, next.dealer, next.score, next.rules);
        next.rounds.push({ round: next.match.round, dealer: next.dealer, score: next.score, levels: [...next.match.levels] });
        next.phase = next.match.winner >= 0 ? 'match_over' : 'round_over';
        emit(next, 'round_scored', { ...next.rounds.at(-1), kitty: next.kitty });
      }
    }
  }
  next.lastAction = { seat, phase: decision.phase, source: envelope.source || state.seats[seat].kind };
  emit(next, 'decision_applied', {
    ...next.lastAction, decisionId: decision.id, version: next.version,
    requested: structuredClone(action),
  }, decision.phase === 'bury' ? seat : 'public');
  return automatic(next);
}
export function nextDeal(state) {
  if (state.phase !== 'round_over') throw new Error('本局尚未结束');
  const next = structuredClone(state);
  next.version++; next.redeals = 0;
  beginDeal(next);
  return automatic(next);
}
export function observation(state, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) throw new Error('无效座位');
  const trump = state.trump || { suit: null, rank: rankFor(state, seat) };
  return {
    schemaVersion: 1, ruleset: state.ruleset, rules: structuredClone(state.rules),
    seat, myTeam: seat % 2, hand: sortedHand(state.hands[seat], trump),
    phase: isBidding(state) ? 'declare' : state.pending?.seat === seat ? state.pending.phase : state.phase,
    handSizes: state.hands.map((hand) => hand.length),
    dealt: state.dealt, closing: state.phase === 'closing',
    trump: state.trump && { ...state.trump }, trumpRank: rankFor(state, seat),
    dealer: state.match.dealer, dealerKnown: state.dealerKnown, declSeat: state.dealer,
    firstTaker: state.first, curDecl: structuredClone(state.declaration), rebelHappened: state.rebelHappened,
    levels: [...state.match.levels], played: [...state.match.played], gates: [...state.rules.gates],
    round: state.match.round, kittySize: 8,
    history: structuredClone([...state.tricks.flatMap((trick) => trick.plays), ...state.plays]),
    plays: structuredClone(state.plays), attackPoints: state.attackPoints,
    declarations: state.events.filter((event) => event.type === 'declaration' && event.seq > (state.events.findLast((event) => event.type === 'deal_started')?.seq ?? -1)).map(({ audience, ...event }) => structuredClone(event)),
    buriedKnown: seat === state.dealer ? structuredClone(state.kitty) : [],
    options: isBidding(state) ? declarationOptions(state.hands[seat], rankFor(state, seat), state.declaration, seat, state.rebelHappened) : state.pending?.seat === seat ? structuredClone(state.pending.options) : null,
    ...(isBidding(state) ? { bidContext: { gameId: state.id, epoch: state.attempts, handCount: state.hands[seat].length, revision: state.declarationRevision, closing: state.phase === 'closing' } } : {}),
  };
}
export function safeAction(view) {
  if (view.phase === 'declare') return { type: 'declare', choice: 'pass' };
  if (view.phase === 'rebel') return { type: 'rebel', accept: false };
  if (view.phase === 'bury') return { type: 'bury', cardIds: view.hand.slice(-8).map((card) => card.id) };
  if (view.phase === 'follow') return { type: 'play', cardIds: safeFollow(view.hand, classify(view.plays[0].cards, view.trump), view.trump, view.rules).map((card) => card.id) };
  return { type: 'play', cardIds: [view.hand.at(-1).id] };
}
export function assertConservation(state) {
  const cards = [...state.deck, ...state.hands.flat(), ...state.kitty, ...state.captured.flat(), ...state.plays.flatMap((play) => play.cards)];
  if (cards.length !== 108 || new Set(cards.map((card) => card.id)).size !== 108) throw new Error('Card conservation violated');
  if (cards.some(card => !Number.isInteger(card.id) || physicalCards[card.id]?.suit !== card.suit || physicalCards[card.id]?.rank !== card.rank)) throw new Error('Physical card identity violated');
}
export function publicView(state, viewer = -1) {
  const permitted = state.seats[viewer]?.kind === 'human';
  const visible = permitted ? observation(state, viewer) : null;
  return {
    id: state.id, version: state.version, ruleset: state.ruleset, rules: state.rules,
    seats: state.seats, phase: state.phase, dealing: state.dealing || 'ordered', dealt: state.dealt, drawSeat: state.drawSeat, match: state.match,
    dealer: state.dealer, trump: state.trump, trumpRank: state.trumpRank,
    declaration: state.declaration, pending: state.pending && { ...state.pending, options: permitted && state.pending.seat === viewer ? state.pending.options : null },
    hand: visible?.hand || [], viewer: permitted ? viewer : -1, handSizes: state.hands.map((hand) => hand.length),
    buriedKnown: visible?.buriedKnown || [], plays: state.plays, tricks: state.tricks,
    attackPoints: state.attackPoints, score: state.score, rounds: state.rounds,
    kitty: state.score ? state.kitty : [], lastAction: state.dealing === 'continuous' && !state.score && state.lastAction?.phase === 'declare' ? null : state.lastAction,
    forcedPasses: state.dealing === 'continuous' && !state.score ? 0 : state.forcedPasses,
    bidOptions: visible?.bidContext ? visible.options : [], bidContext: visible?.bidContext || null,
    events: state.events.filter((event) => event.audience === 'public' || permitted && event.audience === viewer || event.audience === 'after_deal' && event.deal <= (state.completedDealEpoch || 0)).filter((event) => event.type !== 'draw').map(({ audience, ...event }) => event),
  };
}
