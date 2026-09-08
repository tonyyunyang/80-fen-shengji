import { createHash } from 'node:crypto';
import { normalizeUsage, referenceCost } from './usage.js';
import { safeAction } from './game.js';
import { classify, pairCount, longestTractor, enumerateLegalFollows } from './rules.js';
import { effectiveSuit } from './cards.js';
import { assertTokenPlanModel, tokenPlanRequestOptions } from './model-catalog.js';
import { redact } from './redact.js';

export const PROVIDERS = ['mock', 'openai', 'claude', 'qwen'];
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
export function compactObservation(view, moves = followMoves(view)) {
  const cards = (hand) => hand.map((card) => [card.id, card.suit, card.rank]);
  const result = {
    v: 2, phase: view.phase, seat: view.seat, team: view.myTeam,
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
  'During dealing only choose one listed declaration ID or pass. You may reconsider after future draws. A dealer-known game keeps its dealer despite counterdeclarations; in the first/no-dealer game the final declarer becomes dealer. No declaration means no-trump, with first taker as dealer when none was set.',
  'Bury eight cards without suit/point restrictions. Aim to maximize your team result across the deal and match. No shell, browsing, or other tools exist.',
  'If speedRun is true, levels use 2,5,10,K,A with at most one ladder step per positive level gain, and mandatory gates do not apply. A zero-level takeover still does not advance.',
  'If offered a redeal, fullRebel=redeal restarts the deal without changing a known dealer; fullRebel=scramble reopens the dealer contest. Eligibility and the maximum number of redeals are enforced by the engine.',
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
export function buildRequest(view, seat, { env = process.env, maxOutput = 512, feedback = '', thinking = false, allowCustomModel = false } = {}) {
  const moves = followMoves(view);
  const tool = toolFor(view.phase, moves);
  const input = JSON.stringify(compactObservation(view, moves)) + (feedback ? '\nPrevious action rejected: ' + feedback : '');
  const prompt = SYSTEM_PROMPT + '\nActive rule settings: ' + JSON.stringify(view.rules);
  if (!seat.model?.trim()) throw new Error('请为 API 座位填写模型 ID');
  if (!providerStatus(env)[seat.provider]) throw new Error('该提供商的服务端 API 配置尚未完成');
  if (seat.provider === 'openai') return {
    legalMoves: moves,
    url: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '') + '/responses',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.OPENAI_API_KEY },
    body: { model: seat.model, store: false, instructions: prompt, input, max_output_tokens: maxOutput,
      tools: [{ type: 'function', ...tool, strict: true }],
      tool_choice: { type: 'function', name: tool.name }, parallel_tool_calls: false },
  };
  if (seat.provider === 'claude') return {
    legalMoves: moves,
    url: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '') + '/v1/messages',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: { model: seat.model, system: prompt, max_tokens: maxOutput, messages: [{ role: 'user', content: input }],
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.parameters }],
      tool_choice: { type: 'auto', disable_parallel_tool_use: true } },
  };
  if (seat.provider === 'qwen') {
    if (!allowCustomModel) assertTokenPlanModel(seat.model, env.QWEN_BASE_URL);
    const modelOptions = tokenPlanRequestOptions(seat.model, maxOutput, tool.name, thinking) ||
      (/^qwen3\.8-/.test(seat.model) ? { max_completion_tokens: maxOutput, enable_thinking: thinking, preserve_thinking: false, parallel_tool_calls: false,
        tool_choice: thinking ? 'auto' : { type: 'function', function: { name: tool.name } } } : { max_tokens: maxOutput, tool_choice: 'auto' });
    return {
      legalMoves: moves,
      url: env.QWEN_BASE_URL.replace(/\/$/, '') + '/chat/completions',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.QWEN_API_KEY },
      body: { model: seat.model, ...modelOptions,
        messages: [{ role: 'system', content: prompt }, { role: 'user', content: input }],
        tools: [{ type: 'function', function: tool }] },
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
  const request = buildRequest(view, seat, options);
  const secrets = Object.entries(options.env || process.env).filter(([key]) => key.endsWith('API_KEY')).map(([, value]) => value);
  const body = JSON.stringify(request.body);
  const metadata = {
    provider: seat.provider, model: seat.model, phase: view.phase, contextVersion: 2,
    legalMoveCount: request.legalMoves?.length ?? null,
    requestBytes: Buffer.byteLength(body), requestHash: createHash('sha256').update(body).digest('hex'),
    outputLimit: options.maxOutput || 512, thinking: request.body.enable_thinking ?? null,
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
      calls = (data.choices?.[0]?.message?.tool_calls || []).map((item) => ({ name: item.function.name, args: JSON.parse(item.function.arguments) }));
    }
    if (calls.length !== 1) throw new Error('模型必须返回恰好一个工具调用');
    const action = parseToolCall(calls[0].name, calls[0].args, view.phase, request.legalMoves);
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
