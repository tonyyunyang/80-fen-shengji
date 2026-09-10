import { analyzeEndgame } from './analysis-worker.js';
import { buildExpertFacts, EXPERT_FACTS_PROMPT } from './expert-facts.js';
import { expertPrompt } from './expert-prompt.js';
import { createHash } from 'node:crypto';
import { normalizeUsage, referenceCost } from './usage.js';
import { safeAction } from './game.js';
import { classify, pairCount, longestTractor, enumerateLegalFollows } from './rules.js';
import { effectiveSuit } from './cards.js';
import { assertTokenPlanModel, tokenPlanRequestOptions, kimiCodeRequestOptions } from './model-catalog.js';
import { redact } from './redact.js';
import { buildNotebook } from './notebook.js';
import { buildDecisionContext } from './decision-context.js';
import { buildStrategyContext } from './strategy-context.js';
import { buildActionContext, constrainToolToObservation } from './action-context.js';
import { buildAdvisorContext, ADVISOR_PROMPT } from './advisor-context.js';
import { buildTeamContext, TEAM_PROMPT, TEAM_ADVISOR_PROMPT } from './team-context.js';
import { buildEndgameEstimates } from './endgame-estimates.js';
import { decisionFirstObservation, DECISION_FIRST_PROMPT } from './decision-brief.js';

export const PROVIDERS = ['mock', 'openai', 'claude', 'qwen'];
const contextVersions = new Map(Object.entries({
  baseline: 2, notebook: 3, tactical: 4, strategic: 5, 'strategic-v2': 6, coached: 7,
  partnership: 8, search: 9, 'partnership-advised': 10, 'decision-first': 11,
  'decision-first-advised': 12, 'partnership-plan': 13, 'partnership-plan-search': 14, 'expert-zh': 15, 'expert-en': 15, 'expert-facts-zh': 16, 'expert-facts-en': 16, 'expert-search-zh': 17, 'expert-search-en': 17, 'expert-search-wide-zh': 18,
}));
export const CONTEXT_PROFILES = Object.freeze([...contextVersions.keys()]);
export const contextVersion = (profile = 'partnership') => contextVersions.get(profile) ?? 3;
const teamProfiles = ['expert-search-wide-zh','expert-search-zh','expert-search-en','expert-zh','expert-en','expert-facts-zh','expert-facts-en','partnership','search','partnership-advised','decision-first','decision-first-advised','partnership-plan','partnership-plan-search'];
const briefProfiles = ['decision-first','decision-first-advised'];
const actionProfiles = ['strategic-v2','coached',...teamProfiles];
export function followMoves(view) {
  return view.phase === 'follow' ? enumerateLegalFollows(view.hand, classify(view.plays[0].cards, view.trump), view.trump, view.rules) : null;
}
export function toolFor(phase, moves = null) {
  const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
  if (phase === 'follow' && moves?.length) return { name: 'play_move', description: 'Choose one move_id from the complete legalMoves list. The list contains every legal card combination and is not strategy-pruned.', parameters: object({ move_id: { type: 'integer', minimum: 0 } }) };
  if (phase === 'declare') return { name: 'declare_trump', description: 'Choose one supplied legal declaration ID, or pass for this opportunity only.', parameters: object({ choice: { type: 'string' } }) };
  if (phase === 'rebel') return { name: 'request_redeal', description: 'Accept or decline an eligible redeal under the current rules.', parameters: object({ accept: { type: 'boolean' } }) };
  const bury = phase === 'bury';
  return { name: bury ? 'bury_cards' : 'play_cards', description: bury ? 'Bury exactly eight unique card IDs from your hand.' : 'Play unique card IDs from your hand, satisfying the supplied following obligations.', parameters: object({ card_ids: { type: 'array', items: { type: 'integer' }, minItems: bury ? 8 : 1, maxItems: bury ? 8 : 25 } }) };
}
export function compactObservation(view, moves = followMoves(view), contextProfile = 'partnership', endgameOverride) {
  const cards = (hand) => hand.map((card) => [card.id, card.suit, card.rank]);
  const result = {
    v: contextVersion(contextProfile), phase: view.phase, seat: view.seat, team: view.myTeam,
    levels: view.levels, passedLevels: view.played, gates: view.gates,
    dealer: view.declSeat, previousDealer: view.dealer, dealerKnown: view.dealerKnown,
    firstTaker: view.firstTaker, trump: view.trump, level: view.trumpRank,
    dealt: view.dealt, closing: view.closing, hand: cards(view.hand),
    handSizes: view.handSizes, declaration: view.curDecl, declarations: view.declarations,
    choices: view.options, attackPoints: view.attackPoints, knownKitty: cards(view.buriedKnown),
    history: view.history.map((play) => [play.seat, cards(play.cards)]),
    trick: view.plays.map((play) => [play.seat, cards(play.cards)]),
  };
  if (view.phase === 'follow') {
    const lead = classify(view.plays[0].cards, view.trump);
    const held = view.hand.filter((card) => effectiveSuit(card, view.trump) === lead.suit);
    const longest = longestTractor(held, view.trump);
    result.mustFollow = {
      count: lead.cards.length, suit: lead.suit, suitCount: Math.min(held.length, lead.cards.length),
      pairs: Math.min(pairCount(held), pairCount(lead.cards)),
      tractorPairs: view.rules.strictTractorFollow && lead.type === 'tractor' ? (longest >= lead.len ? lead.len : view.rules.partialTractorFollow && longest >= 2 ? longest : 0) : 0,
    };
  }
  if (moves?.length) result.legalMoves = moves.map((ids, id) => ({ id, card_ids: ids }));
  if (contextProfile !== 'baseline') result.notebook = buildNotebook(view);
  if (['tactical',...teamProfiles].includes(contextProfile)) result.decisionContext = buildDecisionContext(view, moves, result.notebook);
  if (['strategic','strategic-v2','coached'].includes(contextProfile)) result.decisionContext = buildStrategyContext(view, moves, result.notebook);
  if (actionProfiles.includes(contextProfile)) result.actionContext = buildActionContext(view, moves, toolFor(view.phase, moves));
  if (teamProfiles.includes(contextProfile)) {
    result.partnership = buildTeamContext(view, result.notebook, result.decisionContext);
    if (['search','partnership-plan-search'].includes(contextProfile)) result.endgameEstimates = buildEndgameEstimates(view, moves);
  }
  if (contextProfile.startsWith('expert-facts-') || contextProfile.startsWith('expert-search-')) result.expertFacts = buildExpertFacts(view, moves, result);
  if (contextProfile.startsWith('expert-search-')) result.endgameEstimates = endgameOverride === undefined ? buildEndgameEstimates(view, moves, {maxHand:12,samples:contextProfile==='expert-search-wide-zh'?32:8}) : endgameOverride;
  if (['coached','partnership-advised','decision-first-advised','partnership-plan','partnership-plan-search'].includes(contextProfile)) result.referenceAdvice = buildAdvisorContext(view, moves, toolFor(view.phase, moves));
  if (briefProfiles.includes(contextProfile)) return decisionFirstObservation(view, result, moves);
  return result;
}
export const SYSTEM_PROMPT = [
  'If legalMoves is present, it is the COMPLETE legal action set. Use play_move to select its integer id; the engine maps it to cards. If absent, use the supplied card-ID tool.',
  'Play Shanghai 80分 with four seats, partners opposite (seat modulo 2). Choose a game action with exactly one supplied tool; do not produce commentary.',
  'Cards are [physical id,suit,rank]: suits S,H,D,C; X jokers. J=11 Q=12 K=13 A=14 small joker=15 big joker=16. Two copies of every face. Only hand IDs can be selected.',
  'Only revealed information is supplied. Do not assume unknown hands or kitty. history is ordered plays; every four is a completed trick, possibly followed by the current incomplete trick.',
  'All jokers, all level-rank cards, and cards of the trump suit are effective suit T. Other cards retain their suit. Within trump: big joker > small joker > trump-suit level > off-suit level > A..2 excluding the level. In no-trump all level cards tie below small joker.',
  'Pairs require identical printed suit and rank. Tractors contain adjacent ordered pairs; skipping the level rank creates adjacency. Equal-order off-suit level pairs cannot link to each other. Lead a single, pair, tractor, or same-effective-suit throw. Mixed effective suits cannot be led.',
  'Follow exact card count, as many led-suit cards as possible, required pairs and tractor pairs. The supplied mustFollow obligations are authoritative. A trump play can win only if its structure matches the lead. Equal plays lose to the earlier play. In a throw, all components must match to contend.',
  'Throws are resolved by the engine: if any other seat can beat a component in the same suit, you must play the lowest-top component instead, without a point penalty. You are not told hidden hands in advance.',
  '5 is worth 5 points; 10 and K are 10 each. The dealer team tries to keep attackers below 80. Attackers take the kitty only if they win the final trick; kitty multiplier is twice the last lead card count. Dealer wins advance 3 levels at 0, 2 below 40, otherwise 1. Attackers take over at 80 and advance floor((total-80)/40). Mandatory levels must be successfully defended.',
  'During dealing only choose one listed declaration ID or pass. You may reconsider after future draws. A dealer-known game keeps its dealer despite counterdeclarations; in a dealer-unknown game the final declarer becomes dealer. No declaration means no-trump, with first taker as dealer when none was set.',
  'Bury eight cards without suit/point restrictions. Aim to maximize your team result across the deal and match. No shell, browsing, or other tools exist.',
  'If speedRun is true, levels use 2,5,10,K,A with at most one ladder step per positive level gain, and mandatory gates do not apply. A zero-level takeover still does not advance.',
  'If offered a redeal, fullRebel=redeal restarts the deal without changing a known dealer; fullRebel=scramble reopens the dealer contest. Eligibility and the maximum number of redeals are enforced by the engine.',
].join('\n');

export const DECISION_CONTEXT_PROMPT = [
  'decisionContext summarizes your hand shape and annotates EVERY move in legalMoves without pruning or ranking the menu. Its move IDs refer to that same complete menu.',
  'Use pointsSpent, trumpsSpent, pairsBroken and remaining structures to compare resource use. winnerSoFar and teamWinningSoFar only compare public cards already played, not unknown future plays. overtakesPartner is a factual warning to consider, not a ban.',
  'higherUnlocatedCopies and tiedUnlocatedCopies include possible cards in the unknown kitty. Zero higher cards does not prevent ruffing, and equal ranks do not beat an earlier equal play. A proven void does not prove the player owns a trump.',
  'On a final trick, weigh the kitty multiplier and the team objective. Unknown kitty points remain unknown. These facts supplement the legal rules; choose the action yourself.',
].join('\n');
export const STRATEGY_PROMPT = [
  'The notebook is a deterministic aid, derived only from this observation. unlocatedFaces are [suit,rank,copies] that may be in other hands OR the unknown kitty. topUnplayed includes your hand; topOutsideHand excludes it. Equal top faces can tie. No opponent ownership or win probability is asserted.',
  'provenVoids mean a seat exhausted that effective suit after a public follow. Unknown suits are not proved present or absent. currentTrick.winningSeat wins so far, not necessarily after remaining seats act.',
  'Before choosing: identify your team goal, who wins now, who is still to play, exposed points, and known voids. Compare the candidate with conserving your trump control, pairs, tractors and entries to partner. Feed points to a winning partner when justified; do not automatically overtake them. Be cautious about opponents who can ruff, and about throwing components that can be beaten. Plan the last trick and kitty exposure.',
  'For burial, compare suit shortening, keeping winning pairs/tractors and trump control, and the points at risk if the last trick is lost. For bidding, compare length, strength and pairs in the proposed trump suit, partner declaration and dealer role, using only the received hand.',
  'Keep deliberation brief and return only the action tool. The entire decision, including any repair, has a shared deadline of at most 12 seconds. Do not request more information or wait for future cards.',
].join('\n');

export const TEAM_PLAN_PROMPT = [
  'referenceAdvice is a competent starting plan made with the same permitted observation, not an optimal oracle. Your sole goal is improving the partnership result; copying it earns no reward.',
  'Compare its concrete team plan with the best alternative. Change the candidate when there is a specific team benefit: securing or preventing the 80-point threshold, cashing safe points, keeping a needed entry, improving useful suit/tractor structure, or preserving final-trick control. Do not change it merely to save a small immediate point card, win personally over partner, or act differently.',
  'A possible unseen card is not proof that a different move is safer. When the proposed alternative has no concrete advantage and mainly depends on guessed ownership, keep the established plan. All legal alternatives remain available and the final action is yours.',
  'Compare promptly and return only the action tool. Do not narrate the comparison.',
].join('\n');

export const STRATEGIC_PROMPT = [
  'Read decisionContext.brief first, then compare the full state. The brief and comparisonSets mechanically identify tied options by visible statistics; they do not restrict the complete legal menu. The readable cards labels help you join move IDs to printed cards.',
  'Decision priorities for partnership 80fen: optimize the TEAM result, not simply the smallest immediate pointsSpent. Choose the move yourself from the complete legal menu.',
  'First read scoreRace, the current winner, who acts after you, and each move.teamOutcome. secured/lost are deductions about the winning TEAM, not guessed opponent hands. unsettled is not safe to treat as a won trick.',
  'If all legal moves lose this trick, start with comparisonSets.leastHighTrumpsSpent and protect future control. Do not throw a joker or level card merely to avoid conceding a modest point card when both plays lose. Prefer the move retaining that control unless the immediate score threshold or a concrete endgame reason is more important. Compare highTrumpsSpent, trumpOrdersSpent and pairsBroken explicitly.',
  'If the trick is secured for your team, bank disposable point cards now when they win equally well and have comparable structural/control cost. A low 5 may be better to cash than saving it for a later lost trick. Use the least expensive winning control; do not automatically overtake a partner.',
  'If the outcome is unsettled, consider the remaining opponents before feeding points. Distinguish overtaking the present winner from surviving later replies. Proven voids allow ruffing only as a possibility unless a trump is publicly known.',
  'When discarding off-suit, compare remainingSuitCounts with handShape and suitControl. Usually shed weak short-suit baggage before dismantling a long suit with winners or useful sequences. Preserve pairs and tractors when that does not sacrifice a more important team objective.',
  'On lead, plan how the partnership will cash side-suit winners and regain the lead. Cash sound pairs/tractors when useful; drawing trump is valuable when it protects such winners, but spending the last control merely to win a low-value trick can lose the ending. Do not assume a throw succeeds against unknown hands.',
  'For burial, balance shortening weak side suits, retained control/structures and the multiplied kitty exposure. For the last few tricks, compare points needed for takeover/next threshold with preserving a final-trick entry; do not hoard control after its useful purpose has passed.',
  'Publicly shown declaration cards are facts. dealer-hand-or-kitty explicitly means their current location is unknown after burial. All other unknown cards remain unknown. Never infer exact ownership from unlocated counts.',
  'Make this comparison briefly and return exactly one tool call. No narrative, extra tools, or request for hidden information.',
].join('\n');

export function parseToolCall(name, args, phase, moves = null) {
  const expected = toolFor(phase, moves).name;
  if (name !== expected || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('模型没有返回当前阶段的工具动作');
  const keys = Object.keys(args);
  if (phase === 'follow' && moves?.length) {
    if (keys.length !== 1 || !Number.isInteger(args.move_id) || !moves[args.move_id]) throw new Error('模型必须选择提供的合法 move_id');
    return { type: 'play', cardIds: [...moves[args.move_id]] };
  }
  if (phase === 'declare' && keys.length === 1 && typeof args.choice === 'string') return { type: 'declare', choice: args.choice };
  if (phase === 'rebel' && keys.length === 1 && typeof args.accept === 'boolean') return { type: 'rebel', accept: args.accept };
  if (['bury', 'lead', 'follow'].includes(phase) && keys.length === 1 && Array.isArray(args.card_ids) && args.card_ids.every(Number.isInteger)) return { type: phase === 'bury' ? 'bury' : 'play', cardIds: args.card_ids };
  throw new Error('模型工具参数不符合协议');
}
export function providerStatus(env = process.env) {
  return { mock: true, openai: !!env.OPENAI_API_KEY, claude: !!env.ANTHROPIC_API_KEY, qwen: !!env.QWEN_API_KEY && !!env.QWEN_BASE_URL };
}
export function buildRequest(view, seat, { env = process.env, maxOutput = 512, feedback = '', thinking = false, thinkingBudget, reasoningEffort, allowCustomModel = false, contextProfile = 'partnership', endgameAnalysis } = {}) {
  if (thinkingBudget !== undefined && (!Number.isInteger(thinkingBudget) || thinkingBudget < 0 || thinkingBudget > maxOutput - 128 || !/^qwen3\.8-/.test(seat.model))) throw new Error('Thinking budget requires a supported Qwen model and space for the final action');
  if (reasoningEffort !== undefined && (seat.provider !== 'qwen' || !['none','low','high','max'].includes(reasoningEffort) || thinkingBudget !== undefined)) throw new Error('Reasoning effort requires Chat Completions and cannot be combined with a thinking budget');
  const moves = followMoves(view);
  const originalTool = toolFor(view.phase, moves);
  const actionContract = actionProfiles.includes(contextProfile);
  const tool = actionContract ? constrainToolToObservation(originalTool, view, moves) : originalTool;
  const compact = compactObservation(view, moves, contextProfile, endgameAnalysis?.value);
  const input = JSON.stringify(compact) + (feedback ? '\nPrevious action rejected: ' + feedback : '');
  const strategic = ['strategic','strategic-v2','coached'].includes(contextProfile);
  const phasePolicy = actionContract && tool.name !== 'play_move' ?
    STRATEGIC_PROMPT.split('\n').filter(line => !/comparisonSets|complete legal menu|each move\.teamOutcome|all legal moves lose|brief first/.test(line)).join('\n') : STRATEGIC_PROMPT;
  const activeContract = compact.actionContext ? '\nCURRENT ACTION CONTRACT (use this exact tool and argument field): ' + compact.actionContext.instruction + (view.phase === 'lead' ? ' Select all lead cards from exactly ONE actionContext.handGroups effectiveSuit. A printed-suit match is insufficient when a level card belongs to T.' : '') : '';
  const decisionPolicy = actionContract && !moves?.length ? DECISION_CONTEXT_PROMPT.split('\n').slice(2).join('\n') : DECISION_CONTEXT_PROMPT;
  const advicePrompt = ['partnership-plan','partnership-plan-search'].includes(contextProfile) ? TEAM_PLAN_PROMPT : compact.partnership ? TEAM_ADVISOR_PROMPT : ADVISOR_PROMPT;
  const standardPrompt = SYSTEM_PROMPT + (briefProfiles.includes(contextProfile) ? '\n' + DECISION_FIRST_PROMPT : (contextProfile === 'baseline' ? '' : '\n' + STRATEGY_PROMPT) + (compact.partnership ? '\n' + TEAM_PROMPT : '') + (compact.decisionContext ? '\n' + decisionPolicy : '') + (strategic ? '\n' + phasePolicy : '') + (compact.referenceAdvice ? '\n' + advicePrompt : '')) + '\nActive rule settings: ' + JSON.stringify(view.rules) + activeContract;
  const prompt = contextProfile.startsWith('expert-') ? expertPrompt(contextProfile.split('-').at(-1)) + ((contextProfile.startsWith('expert-facts-') || contextProfile.startsWith('expert-search-')) ? '\n' + EXPERT_FACTS_PROMPT[contextProfile.split('-').at(-1)] : '') + (contextProfile.startsWith('expert-search-') ? (contextProfile.endsWith('-zh') ? '\n残局估计endgameEstimates比较同一组符合公开牌史的可能分牌，绝不是真实隐藏手牌，也不是校准胜率。每个假设后续由只看自身假设手牌的快速本地策略完成。sampledTeamWins为模拟中本方赢局次数，不是复制该策略动作的分数。优先比较各选择的团队胜负及攻方总分，再用当前明确事实审查；你仍可选择任何合法动作。' : '\nendgameEstimates compares the same hypothetical allocations consistent with public play, never real hidden hands or calibrated win probabilities. Each simulated continuation uses a fast local policy seeing only its own hypothetical observation. sampledTeamWins counts partnership deal wins, not agreement with that policy. Compare team outcomes and attacker totals, then check public tactical facts; all legal actions remain available.') : '') + '\nActive rule settings: ' + JSON.stringify(view.rules) + activeContract : standardPrompt;
  if (!seat.model?.trim()) throw new Error('请为 API 座位填写模型 ID');
  if (!providerStatus(env)[seat.provider]) throw new Error('该提供商的服务端 API 配置尚未完成');
  if (seat.provider === 'openai') return {
    legalMoves: moves,
    referenceAdvice: compact.referenceAdvice,
    url: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '') + '/responses',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.OPENAI_API_KEY },
    body: { model: seat.model, store: false, instructions: prompt, input, max_output_tokens: maxOutput,
      tools: [{ type: 'function', ...tool, strict: true }],
      tool_choice: { type: 'function', name: tool.name }, parallel_tool_calls: false },
  };
  if (seat.provider === 'claude') return {
    legalMoves: moves,
    referenceAdvice: compact.referenceAdvice,
    url: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '') + (/\/v1\/*$/.test(env.ANTHROPIC_BASE_URL || '') ? '/messages' : '/v1/messages'),
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: { model: seat.model, system: prompt, max_tokens: maxOutput, messages: [{ role: 'user', content: input }],
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.parameters }],
      tool_choice: { type: 'auto', disable_parallel_tool_use: true } },
  };
  if (seat.provider === 'qwen') {
    if (!allowCustomModel) assertTokenPlanModel(seat.model, env.QWEN_BASE_URL);
    const modelOptions = kimiCodeRequestOptions(seat.model, env.QWEN_BASE_URL, maxOutput, thinking, tool.name) || tokenPlanRequestOptions(seat.model, maxOutput, tool.name, thinking) ||
      (/^qwen3\.8-/.test(seat.model) ? { max_completion_tokens: maxOutput, enable_thinking: thinking, preserve_thinking: false, parallel_tool_calls: false,
        tool_choice: thinking ? 'auto' : { type: 'function', function: { name: tool.name } } } : { max_tokens: maxOutput, tool_choice: 'auto' });
    const jsonAction = !!kimiCodeRequestOptions(seat.model, env.QWEN_BASE_URL, maxOutput) && !thinking && (reasoningEffort === undefined || reasoningEffort === 'none');
    const body = { model: seat.model, ...modelOptions, ...(thinking && thinkingBudget !== undefined ? { thinking_budget: thinkingBudget } : {}), ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: input }], tools: [{ type: 'function', function: tool }] };
    if (jsonAction) {
      delete body.tools; delete body.tool_choice; delete body.parallel_tool_calls;
      body.response_format = { type: 'json_object' };
      body.messages[0].content += '\n' + (contextProfile.endsWith('-zh') ?
        '传输约定：本次接口使用JSON动作，没有可调用的工具。只输出工具参数本身的JSON对象，禁止函数语法、Markdown、解释或额外包装字段。严格按此schema：' :
        'Transport contract: this request uses a JSON action, with no callable tools. Return only the argument object matching this schema, with no function syntax, Markdown, explanation or wrapper fields: ') + JSON.stringify(tool.parameters);
    }
    return {
      legalMoves: moves,
      referenceAdvice: compact.referenceAdvice,
      actionFormat: jsonAction ? 'json_action' : 'native_tools',
      url: env.QWEN_BASE_URL.replace(/\/$/, '') + '/chat/completions',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.QWEN_API_KEY },
      body,
    };
  }
  throw new Error('不支持的提供商');
}
export async function requestAction(view, seat, options = {}) {
  const started = performance.now();
  if (seat.provider === 'mock') {
    const action = safeAction(view);
    const moves = followMoves(view);
    const tool = toolFor(view.phase, moves);
    const match = moves?.findIndex((ids) => ids.length === action.cardIds?.length && ids.every((id) => action.cardIds.includes(id)));
    const args = moves?.length ? { move_id: match } : action.type === 'declare' ? { choice: action.choice } : action.type === 'rebel' ? { accept: action.accept } : { card_ids: action.cardIds };
    return { action: parseToolCall(tool.name, args, view.phase, moves), usage: { input: 0, output: 0, cached: 0, cacheWrite: 0 }, ms: performance.now() - started, simulated: true };
  }
  if (options.contextProfile?.startsWith('expert-search-')) options = {...options,endgameAnalysis:await analyzeEndgame(view,followMoves(view),options.signal,options.contextProfile==='expert-search-wide-zh'?{samples:32,maxMs:2500}:undefined)};
  const request = buildRequest(view, seat, options);
  const secrets = Object.entries(options.env || process.env).filter(([key]) => key.endsWith('API_KEY')).map(([, value]) => value);
  const body = JSON.stringify(request.body);
  const metadata = {
    provider: seat.provider, model: seat.model, phase: view.phase, actionFormat: request.actionFormat || 'native_tools', analysisStatus: options.endgameAnalysis?.status ?? null, analysisMs: options.endgameAnalysis?.ms ?? null, contextVersion: contextVersion(options.contextProfile),
    promptLanguage: options.contextProfile?.startsWith('expert-') ? options.contextProfile.split('-').at(-1) : 'en',
    legalMoveCount: request.legalMoves?.length ?? null,
    requestBytes: Buffer.byteLength(body), requestHash: createHash('sha256').update(body).digest('hex'),
    outputLimit: options.maxOutput || 512, thinking: request.body.enable_thinking ?? null, thinkingBudget: request.body.thinking_budget ?? null, reasoningEffort: request.body.reasoning_effort ?? null,
    requiredCardCount: view.phase === 'follow' ? view.plays[0].cards.length : view.phase === 'bury' ? 8 : null,
    advisorPolicy: request.referenceAdvice?.policy || null,
    responseId: null, requestId: null, httpStatus: null, finishReason: null,
    usage: normalizeUsage(seat.provider, null), usageKnown: false, referenceCost: null,
    headersMs: null, ms: null,
  };
  try {
    const response = await (options.fetchImpl || fetch)(request.url, {
      method: 'POST', headers: request.headers, body, signal: options.signal, redirect: 'error',
    });
    metadata.httpStatus = response.status ?? (response.ok ? 200 : null);
    metadata.headersMs = performance.now() - started;
    metadata.requestId = response.headers?.get?.('x-request-id') || response.headers?.get?.('x-dashscope-request-id') || null;
    metadata.billingHeaders = Object.fromEntries((response.headers?.entries ? [...response.headers.entries()] : [])
      .filter(([name]) => /credit|billing|cost/i.test(name) && !/time|duration|latency/i.test(name))
      .map(([name, value]) => [name, /^\d+(\.\d+)?$/.test(value) ? Number(value) : 'present; non-numeric value omitted']));
    let data;
    try { data = await response.json(); } catch { throw new Error('提供商返回了无效 JSON'); }
    metadata.responseId = typeof data.id === 'string' ? data.id : null;
    metadata.resolvedModel = typeof data.model === 'string' ? data.model : null;
    metadata.reportedUsage = data.usage && typeof data.usage === 'object' ? structuredClone(data.usage) : null;
    metadata.responseFields = Object.keys(data);
    metadata.usage = normalizeUsage(seat.provider, data.usage);
    metadata.usageKnown = metadata.usage.input !== null && metadata.usage.output !== null;
    metadata.referenceCost = options.referencePrice === undefined ? (seat.provider === 'qwen' ? referenceCost(seat.model, metadata.usage) : null) :
      options.referencePrice && metadata.usageKnown ? {
        amount: (metadata.usage.input * options.referencePrice.input + metadata.usage.output * options.referencePrice.output) / 1e6,
        currency: 'USD', actualCharge: false, basis: 'User-supplied per-million token reference; not an invoice', tokenPlanCredits: null,
      } : null;
    metadata.finishReason = data.choices?.[0]?.finish_reason ?? data.stop_reason ?? data.status ?? null;
    if (!response.ok) throw new Error(seat.provider + ' HTTP ' + metadata.httpStatus + '：请检查服务端配置或稍后重试');
    let calls;
    if (seat.provider === 'openai') {
      if (data.status === 'incomplete') throw new Error('模型输出达到上限，动作未完成');
      calls = (data.output || []).filter((item) => item.type === 'function_call').map((item) => ({ name: item.name, args: JSON.parse(item.arguments) }));
    } else if (seat.provider === 'claude') {
      if (data.stop_reason === 'max_tokens') throw new Error('模型输出达到上限，动作未完成');
      calls = (data.content || []).filter((item) => item.type === 'tool_use').map((item) => ({ name: item.name, args: item.input }));
    } else {
      if (data.choices?.[0]?.finish_reason === 'length') throw new Error('模型输出达到上限，动作未完成');
      const message = data.choices?.[0]?.message;
      if (request.actionFormat === 'json_action') {
        metadata.toolCallCount = message?.tool_calls?.length || 0;
        if (metadata.toolCallCount) throw new Error('JSON动作接口不能同时返回工具调用');
        if (typeof message?.content !== 'string') throw new Error('模型未返回JSON动作');
        // Parse the whole response. Never extract JSON out of prose or execute
        // function-looking text; the normal action parser and engine still validate it.
        calls = [{ name: toolFor(view.phase, request.legalMoves).name, args: JSON.parse(message.content) }];
      } else calls = (message?.tool_calls || []).map((item) => ({ name: item.function.name, args: JSON.parse(item.function.arguments) }));
    }
    metadata.toolCallCount ??= calls.length;
    metadata.actionCount = calls.length;
    metadata.actionNameMatches = calls.length === 1 && calls[0].name === toolFor(view.phase, request.legalMoves).name;
    metadata.toolNameMatches = request.actionFormat === 'json_action' ? null : metadata.actionNameMatches;
    metadata.argumentFields = calls.length === 1 && calls[0].args && typeof calls[0].args === 'object' ? [...new Set(Object.keys(calls[0].args).map(key => ['card_ids','move_id','choice','accept'].includes(key) ? key : 'unexpected'))] : [];
    metadata.returnedCardCount = calls.length === 1 && Array.isArray(calls[0].args?.card_ids) ? calls[0].args.card_ids.length : null;
    metadata.argumentValueTypes = calls.length === 1 ? Object.fromEntries(Object.entries(calls[0].args || {}).filter(([key])=>['card_ids','move_id','choice','accept'].includes(key)).map(([key,value])=>[key,Array.isArray(value)?[...new Set(value.map(item=>typeof item))]:typeof value])) : null;
    if (calls.length !== 1) throw new Error('模型必须返回恰好一个工具调用');
    const action = parseToolCall(calls[0].name, calls[0].args, view.phase, request.legalMoves);
    if (request.referenceAdvice) {
      const expected = request.referenceAdvice.tool.arguments;
      metadata.referenceAdviceFollowed = expected.move_id !== undefined ? calls[0].args.move_id === expected.move_id :
        action.cardIds.length === expected.card_ids.length && action.cardIds.every(id => expected.card_ids.includes(id));
    }
    metadata.ms = performance.now() - started;
    return { action, usage: metadata.usage, ms: metadata.ms, simulated: false, usageKnown: metadata.usageKnown, metering: redact(metadata, secrets) };
  } catch (cause) {
    metadata.ms = performance.now() - started;
    // Preserve reported consumption even for malformed tools, truncation, and HTTP errors.
    // Never attach requests, authorization headers, or raw completion text.
    const message = cause instanceof SyntaxError ? '模型工具参数包含无效 JSON' : cause.message;
    const error = new Error(redact(message, secrets));
    error.metering = redact(metadata, secrets);
    throw error;
  }
}
