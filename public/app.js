import { SYMBOLS, rankLabel, cardLabel } from '/src/cards.js';
import { classify, safeFollow } from '/src/rules.js';
import { trainingQuestion } from '/src/training.js';
import { decisionTimeoutMs, MAX_DECISION_MS } from '/src/player-settings.js';
import { TOKEN_PLAN_MODELS, DEFAULT_TOKEN_PLAN_MODEL, tokenPlanModel, formatRate, CATALOG_CHECKED_AT, MODEL_SOURCES } from '/src/model-catalog.js';
import { patchHtml, escapeHtml as escape } from './dom.js';
import { cardFace } from './card-art.js';
import { selectionError, selectRange, selectPair } from './hand-tools.js';
import { createTableScene } from './table-scene.js';
import { apiSeatFields, connectionFor, setupConnectionsDialog } from './connections-ui.js';
import { TrickFlow, TRICK_TIMING, tableScope } from './table-flow.js';
import { tableOverview, centerDeck, trickPlays, collectedMarker, lastTrickSummary, kittyPocket, cardBack, seatLabel } from './table-view.js';

const $ = (id) => document.getElementById(id);
const directions = ['南', '东', '北', '西'];
const positions = ['south', 'east', 'north', 'west'];
const typeName = seat => {
  if (seat.kind === 'human') return '人类玩家';
  if (seat.kind === 'peilian') return '陪练';
  if (seat.provider === 'mock') return '离线模拟';
  const profile = connectionFor(seat, latest?.connections);
  return profile?.active ? (profile.models.find(m => m.id === seat.model)?.label || seat.model) + ' · API' : 'API 未启用 · 陪练代打';
};
const defaultSeats = () => directions.map((direction, index) => ({ name: index === 0 ? '你' : direction + '家', kind: index ? 'api' : 'human', provider: index ? 'qwen' : 'mock', model: index ? DEFAULT_TOKEN_PLAN_MODEL : '' }));
const practiceSeats = () => defaultSeats().map((seat, index) => ({ ...seat, kind: index ? 'peilian' : 'human', provider: 'mock', model: '' }));
const setupDefaultsVersion = 3;
let config = { setupDefaultsVersion, seats: defaultSeats(), rules: { gates: true, fullRebel: 'off', speedRun: false, partialTractorFollow: true }, limits: { maxRequests: 100 }, speed: 600 };
try {
  const stored = JSON.parse(localStorage.getItem('eighty-config'));
  if (stored?.seats?.length === 4 && stored.seats.every(seat => seat && ['human', 'api', 'peilian'].includes(seat.kind))) {
    // Apply the owner's new default once, keeping rules and cost limits. Later seat edits persist.
    config = stored.setupDefaultsVersion === setupDefaultsVersion ? stored : { ...stored, setupDefaultsVersion, seats: defaultSeats() };
  }
  localStorage.setItem('eighty-config', JSON.stringify(config));
} catch {}
config.rules = { gates: true, fullRebel: 'off', speedRun: false, partialTractorFollow: true, ...config.rules };
try { config.limits = { ...config.limits, timeoutMs: decisionTimeoutMs(config.limits?.timeoutMs) }; }
catch { config.limits = { maxRequests: 100, timeoutMs: MAX_DECISION_MS }; }
let status = { mock: true, openai: false, claude: false, qwen: false };
let latest = null, viewer = 0, stream, selected = new Set(), lastDecision = null, noticeTimer;
let quiz = null, quizKey = null, quizSelection = new Set(), quizAnswered = false;
let arriving = null, csrfToken = '', reconnecting = false;
let connected = false, submitting = false, starting = false, anchor = null, focusCard = null, scene, sceneStarting = false, presentedGame = null;
const clientId = crypto.randomUUID();
let depthEnabled = true;
try { depthEnabled = localStorage.getItem('eighty-depth') !== 'off'; } catch {}
const trickFlow = new TrickFlow(), motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let tableMotion = null, motionTimer;
motionPreference.addEventListener('change', () => render());
document.addEventListener('visibilitychange', () => render());

function notify(message) {
  $('notice').textContent = message; $('notice').hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000);
}
async function post(path, data) {
  const response = await fetch('/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-eighty-csrf': csrfToken }, body: JSON.stringify(data), signal: AbortSignal.timeout(8000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
function option(value, label, current, disabled = false) {
  return '<option value="' + escape(value) + '"' + (value === current ? ' selected' : '') + (disabled ? ' disabled' : '') + '>' + escape(label) + '</option>';
}
function modelComparison() {
  return '<details class="model-catalog" id="modelCatalog"><summary>Token Plan 模型与价格 · ' + TOKEN_PLAN_MODELS.length + ' 款</summary><p class="fine">USD / 每百万 tokens。以小上下文比较，变价模型列出忙时 / 闲时价格。</p>' +
    '<table><thead><tr><th scope="col">模型</th><th scope="col">输入</th><th scope="col">输出</th></tr></thead><tbody>' +
    TOKEN_PLAN_MODELS.map((model) => '<tr><th scope="row">' + escape(model.label) + (model.largerContext ? '<small>≤ ' + model.largerContext.above + ' 输入</small>' : '') + '</th><td>' + formatRate(model.input) + (model.offPeak ? ' / ' + formatRate(model.offPeak.input) : '') + '</td><td>' + formatRate(model.output) + (model.offPeak ? ' / ' + formatRate(model.offPeak.output) : '') + '</td></tr>').join('') +
    '</tbody></table><p class="fine">Token Plan 按 Credits 动态扣费，上述标准价不是实际扣费。缓存、活动与上下文档位会影响费用。当前只使用文字输入和工具动作。</p><p class="fine"><a href="' + MODEL_SOURCES.plan + '" target="_blank" rel="noreferrer">官方模型与 Credits 说明</a> · <a href="' + MODEL_SOURCES.pricing + '" target="_blank" rel="noreferrer">完整价目表</a><br>核验日期：' + CATALOG_CHECKED_AT + '</p></details>';
}
function renderSetup() {
  const opened = [...$('setup').querySelectorAll('details[open]')].map(node => node.id), focus = document.activeElement?.id;
  $('setup').innerHTML = config.seats.map((seat, index) =>
    '<div class="seat-form"><div class="seat-letter team-' + index % 2 + '">' + directions[index] + '</div><div><label for="kind-' + index + '">' + (index % 2 ? '东西搭档' : '南北搭档') + '</label><select id="kind-' + index + '" aria-label="' + directions[index] + '家玩家类型">' +
    option('human', '人类玩家', seat.kind) + option('peilian', '陪练 · 本地策略', seat.kind) + option('api', 'API 模型', seat.kind) + '</select></div>' +
    (seat.kind === 'api' ? apiSeatFields(seat, index, latest?.connections || []) : '') + '</div>'
  ).join('') +
    '<div class="presets"><button class="preset" id="apiPreset">一人 · 三 API</button><button class="preset" id="practicePreset">一人 · 三陪练</button><button class="preset" id="mixedPreset">两席离线模拟</button><button class="preset" id="watchPreset">四席观战</button></div>' +
    modelComparison() +
    '<details class="options" id="tableOptions"><summary>牌桌设置</summary>' +
    '<label class="option-row">必打 2 / 5 / 10 / K<input id="gates" type="checkbox"' + (config.rules.gates !== false ? ' checked' : '') + '></label>' +
    '<label class="option-row">速通阶梯<input id="speedRun" type="checkbox"' + (config.rules.speedRun ? ' checked' : '') + '></label>' +
    '<label class="option-row">有短拖拉机也须跟<input id="partial" type="checkbox"' + (config.rules.partialTractorFollow !== false ? ' checked' : '') + '></label>' +
    '<label class="option-row">低分 / 少主重发<select id="rebel">' + option('off', '关闭', config.rules.fullRebel) + option('redeal', '仅重新发牌', config.rules.fullRebel) + option('scramble', '重发并重新抢庄', config.rules.fullRebel) + '</select></label>' +
    '<label class="option-row">发牌节奏<select id="dealSpeed">' + option('500', '从容 · 每人每 2 秒一张', String(config.dealIntervalMs || 500)) + option('700', '慢速 · 每人每 2.8 秒一张', String(config.dealIntervalMs || 500)) + '</select></label>' +
    '<label class="option-row">机器出牌节奏<select id="speed">' + option('600', '从容 · 600ms', String(config.speed)) + option('1200', '慢速 · 1.2s', String(config.speed)) + option('100', '快速 · 100ms', String(config.speed)) + '</select></label>' +
    '<label class="option-row">本桌 API 请求上限<input id="requestLimit" type="number" min="0" max="2000" value="' + escape(config.limits.maxRequests) + '"></label><p class="fine">设为 0 时，API 席全部由陪练代打，不发送请求。</p>' +
    '<label class="option-row">单次输出上限<input id="outputLimit" type="number" min="128" max="4096" value="' + (config.limits.maxOutput || 512) + '"></label>' +
    '<label class="option-row">API 决策限时（含重试）<input id="timeoutLimit" type="number" min="1" max="' + MAX_DECISION_MS / 1000 + '" value="' + (config.limits.timeoutMs / 1000) + '" aria-label="API 决策最长等待秒数"></label><p class="fine">最多等待 12 秒，超时由陪练代打本次。下一次仍优先使用 API。</p></details>' +
    (latest?.restoreAvailable && !latest.game ? '<button class="secondary restore-local" id="restoreLocal">继续此前的本地牌局</button>' : '') +
    '<button class="primary start" id="startGame"' + (!csrfToken ? ' disabled' : '') + '><span>' + (latest?.game ? '开始新牌桌' : '开始牌局') + '</span><span>→</span></button>' +
    '<p class="fine">默认一位人类与三位 Qwen 3.8 Flash 席位。先在「API 连接」填自己的 key；未启用时由陪练代打。</p>';
  for (const id of opened) if ($(id)) $(id).open = true;
  if (focus && $('setup').contains($(focus))) $(focus).focus({ preventScroll: true });
  config.seats.forEach((seat, index) => {
    $('kind-' + index).onchange = (event) => { config.seats[index].kind = event.target.value; if (event.target.value === 'api') { config.seats[index].provider = 'qwen'; config.seats[index].connectionId = 'alibaba'; config.seats[index].model = DEFAULT_TOKEN_PLAN_MODEL; } storeConfig(); renderSetup(); };
    if ($('provider-' + index)) $('provider-' + index).onchange = event => {
      const profile = latest.connections.find(p => p.id === event.target.value);
      config.seats[index].provider = profile?.provider || 'mock';
      config.seats[index].connectionId = profile?.id;
      config.seats[index].model = profile?.models[0]?.id || '';
      storeConfig(); renderSetup();
    };
    if ($('model-' + index)) {
      const update = (event) => { config.seats[index].model = event.target.value; storeConfig(); renderSetup(); };
      $('model-' + index).onchange = update;
    }
  });
  $('gates').onchange = (event) => { config.rules.gates = event.target.checked; storeConfig(); };
  $('speedRun').onchange = (event) => { config.rules.speedRun = event.target.checked; storeConfig(); };
  $('partial').onchange = (event) => { config.rules.partialTractorFollow = event.target.checked; storeConfig(); };
  $('rebel').onchange = (event) => { config.rules.fullRebel = event.target.value; storeConfig(); };
  $('dealSpeed').onchange = (event) => { config.dealIntervalMs = Number(event.target.value); storeConfig(); };
  $('speed').onchange = (event) => { config.speed = Number(event.target.value); storeConfig(); };
  $('requestLimit').onchange = (event) => { config.limits.maxRequests = Number(event.target.value); storeConfig(); };
  $('outputLimit').onchange = (event) => { config.limits.maxOutput = Number(event.target.value); storeConfig(); };
  $('timeoutLimit').onchange = (event) => { config.limits.timeoutMs = decisionTimeoutMs(Number(event.target.value) * 1000); event.target.value = config.limits.timeoutMs / 1000; storeConfig(); };
  $('apiPreset').onclick = () => { config.seats = defaultSeats(); storeConfig(); renderSetup(); };
  $('practicePreset').onclick = () => { config.seats = practiceSeats(); storeConfig(); renderSetup(); };
  $('mixedPreset').onclick = () => {
    config.seats = practiceSeats(); config.seats[1].kind = 'api'; config.seats[3].kind = 'api';
    storeConfig(); renderSetup();
  };
  $('watchPreset').onclick = () => { config.seats = practiceSeats().map((seat, index) => ({ ...seat, kind: 'peilian', name: directions[index] + '家' })); storeConfig(); renderSetup(); };
  $('startGame').onclick = async () => {
    if (starting) return;
    if (latest?.game && !confirm('开始新牌桌将替换当前牌局。继续？')) return;
    starting = true; $('startGame').disabled = true;
    try {
      await post('start', config);
      viewer = config.seats.findIndex((seat) => seat.kind === 'human');
      selected.clear(); quiz = null; quizKey = null; connect(); renderSetup();
    } catch (error) { notify(error.message); }
    finally { starting = false; if ($('startGame')) $('startGame').disabled = false; }
  };
  if ($('restoreLocal')) $('restoreLocal').onclick = async () => { try { await post('restore-local', {}); await refreshState(); } catch(error) { notify(error.message); } };
  if (!latest?.game) render();
}
function storeConfig() { try { localStorage.setItem('eighty-config', JSON.stringify(config)); } catch { notify('浏览器未能保存设置，本次仍可使用。'); } }
function presence() {
  fetch('/api/presence', { method: 'POST', headers: { 'content-type': 'application/json', 'x-eighty-csrf': csrfToken }, body: JSON.stringify({ clientId, visible: !document.hidden }), keepalive: true }).catch(() => {});
}
document.addEventListener('visibilitychange', presence);
function receive(next) {
  if (next.csrf === csrfToken && next.revision < latest?.revision) return;
  const oldProfiles = JSON.stringify(latest?.connections || []);
  csrfToken = next.csrf || '';
  if (latest?.game && next.game && latest.game.id === next.game.id && latest.game.viewer === next.game.viewer && next.game.version < latest.game.version) return;
  const oldIds = new Set(latest?.game && latest.game.id === next.game?.id ? latest.game.hand.map(card => card.id) : []);
  const added = next.game?.hand?.find(card => !oldIds.has(card.id));
  if (added && next.game.dealing === 'continuous' && ['dealing', 'closing'].includes(next.game.phase)) arriving = { id: added.id, at: Date.now() };
  latest = next;
  if (JSON.stringify(status) !== JSON.stringify(latest.providers) || oldProfiles !== JSON.stringify(latest.connections || [])) { status = latest.providers; renderSetup(); }
  const decisionKey = [latest.game?.id, latest.game?.attempts, viewer, latest.game?.pending?.id].join(':');
  if (lastDecision !== decisionKey) { selected.clear(); anchor = null; lastDecision = decisionKey; }
  selected = new Set([...selected].filter(id => latest.game?.hand.some(card => card.id === id)));
  render();
}
async function refreshState() {
  const next = await fetch('/api/state?seat=' + viewer).then(response => response.json());
  if (!next.csrf) throw new Error('本地服务暂不可用');
  receive(next); return next;
}
function connect() {
  stream?.close();
  connected = false;
  const connection = new EventSource('/api/events?seat=' + viewer + '&client=' + clientId + '&visible=' + !document.hidden); stream = connection;
  connection.onmessage = (event) => {
    if (stream !== connection) return;
    const reconnect = !connected; connected = true;
    receive(JSON.parse(event.data)); if (reconnect) presence();
  };
  connection.onerror = async () => {
    if (stream !== connection) return;
    connected = false; render();
    if (!reconnecting) {
      reconnecting = true;
      try { await refreshState(); if (stream === connection) connect(); } catch {}
      finally { reconnecting = false; }
    }
  };
}
function mini(card) {
  return '<span class="mini-card ' + (['H', 'D'].includes(card.suit) ? 'red ' : '') + (card.suit === 'X' ? 'joker ' : '') + '" title="' + escape(cardLabel(card)) + '"><span>' + escape(rankLabel(card.rank)) + '</span><span>' + (card.suit === 'X' ? '✦' : SYMBOLS[card.suit]) + '</span></span>';
}
function seatHTML(seat, index, game) {
  const active = game?.pending?.seat === index && !latest?.paused && !tableMotion;
  const thinking = game?.pending?.seat === index && latest?.busy?.seat === index && latest.busy.api && !latest.paused;
  const tookTrick = game?.tricks.at(-1)?.winner === index;
  const indicator = thinking ? '<div class="thinking-indicator" role="status" aria-label="' + escape(seat.name) + ' 正在思考，最多等待 ' + (latest.busy.deadlineAt - latest.busy.startedAt) / 1000 + ' 秒"><span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>' + (tableMotion ? '下墩思考' : '思考中') + '</span><span class="thinking-time" data-thinking-deadline="' + latest.busy.deadlineAt + '" aria-hidden="true"></span></div>' : '';
  return '<div data-key="seat-' + index + '" class="seat ' + positions[index] + (active ? ' active' : '') + (thinking ? ' thinking' : '') + (tookTrick ? ' took-trick' : '') + '" aria-busy="' + Boolean(thinking) + '"><span class="avatar team-' + index % 2 + '">' + directions[index] + '</span><div><div class="seat-name">' + escape(seat.name) + (game?.dealer === index ? '<span class="dealer-tag">庄</span>' : '') + '</div><div class="seat-sub">' + escape(typeName(seat)) + '</div>' + (game ? '<span class="hand-size">' + game.handSizes[index] + '<small> 张</small>' + (index === viewer ? ' · 你' : index % 2 === viewer % 2 ? ' · 搭档' : '') + '</span>' : '') + indicator + '</div>' + collectedMarker(game, index, tableMotion) + '</div>';
}
function updateThinkingClock() {
  document.querySelectorAll('[data-closing-at]').forEach((node) => {
    const remaining = latest?.paused ? Number(node.dataset.closingRemaining) : Number(node.dataset.closingAt) - Date.now();
    node.textContent = remaining > 0 ? Math.ceil(remaining / 1000) + ' 秒' : '正在定主…';
  });
  document.querySelectorAll('[data-thinking-deadline]').forEach((node) => {
    const seconds = Math.max(0, (Number(node.dataset.thinkingDeadline) - Date.now()) / 1000);
    node.textContent = seconds > 0 ? seconds.toFixed(1) + 's' : '陪练接手中';
  });
}
setInterval(updateThinkingClock, 100);
function gameTable(game) {
  const seats = game?.seats || config.seats;
  return '<div class="table' + (!game ? ' lobby-table' : ' game-table') + '" id="cardTable"><div id="tableScene" data-preserve aria-hidden="true"></div><span class="table-signature" aria-hidden="true">EIGHTY · 上海</span>' + seats.map((seat, index) => seatHTML(seat, index, game)).join('') +
    (!game ? '<div class="table-center"><span class="watermark">80</span><span class="table-caption">相隔一席 · 始终同队</span></div>' : centerDeck(game, latest.dealClock) + kittyPocket(game)) +
    (game?.dealing === 'continuous' && game.phase === 'dealing' && latest.dealClock?.lastDrawAt && Date.now() - latest.dealClock.lastDrawAt < 350 ? '<span data-key="draw-' + game.dealt + '" class="deal-flight ' + positions[game.drawSeat] + '" aria-hidden="true">' + cardBack() + '</span>' : '') +
    (game ? trickPlays(game, tableMotion, mini, matchMedia('(max-width:600px)').matches, $('cardTable')?.clientWidth || 800) : '') +
    (!game ? '<div class="placeholder-note"><button class="table-start" id="quickStart" aria-label="按当前座位设置开始牌局">入座开局 <span>→</span></button><small>可在「四席入座」更换玩家与模型</small></div>' : '') + '</div>';
}
function handCard(card, canAct, game) {
  const trump = game.trump && (card.suit === 'X' || card.rank === game.trump.rank || card.suit === game.trump.suit);
  return '<button class="card ' + (arriving?.id === card.id && Date.now() - arriving.at < 350 ? 'card-arriving ' : '') + (['H', 'D'].includes(card.suit) ? 'red ' : '') + (card.suit === 'X' ? 'joker ' : '') + (trump ? 'trump ' : '') + (selected.has(card.id) ? 'selected' : '') + '" data-card="' + card.id + '" tabindex="' + (card.id === focusCard || !game.hand.some(c => c.id === focusCard) && card.id === game.hand[0]?.id ? '0' : '-1') + '" aria-label="' + escape(cardLabel(card)) + ' 第' + (card.id >= 54 ? '二' : '一') + '张' + (trump ? '，主牌' : '') + '" aria-pressed="' + selected.has(card.id) + '"' + (!canAct ? ' disabled' : '') + '>' + cardFace(card) + (trump ? '<span class="trump-mark" aria-hidden="true">主</span>' : '') + '</button>';
}
function handPanel(game) {
  if (!game) return '<div class="hand-panel"><div class="hand-header">你的手牌 <span>牌局开始后，手牌会出现在这里</span></div><div class="empty-hand">与对家配合，守住或拿下 80 分。<br>陪练随时在座，模型由你接入。</div></div>';
  const decision = game.pending;
  const bidding = game.dealing === 'continuous' && ['dealing', 'closing'].includes(game.phase);
  const needsHandoff = game.seats.filter((seat) => seat.kind === 'human').length > 1 && decision && game.seats[decision.seat].kind === 'human' && viewer !== decision.seat;
  if (needsHandoff) return '<div class="hand-panel curtain"><h3>请把屏幕交给 ' + escape(game.seats[decision.seat].name) + '</h3><p>其他玩家的手牌已收起。准备好后再查看自己的牌。</p><button class="primary" id="handoff">查看我的手牌</button></div>';
  const myTurn = connected && !submitting && decision?.seat === viewer && !latest.paused && !latest.autoplay.includes(viewer);
  const playing = myTurn && ['lead', 'follow', 'bury'].includes(decision.phase);
  let actions = '';
  if (bidding) actions = latest.paused ? '<div class="turn-notice">牌局已暂停，继续后可亮主。</div>' : viewer >= 0 && !latest.autoplay.includes(viewer) ? '<div class="bid-options"><span class="turn-message">' + (game.bidOptions.length ? '可随时亮主，发牌会继续' : '拿到级牌后，可以在这里亮主') + '</span>' + game.bidOptions.map(item => '<button class="secondary gold" data-key="bid-' + item.id + '" data-bid="' + item.id + '"' + (!connected || submitting ? ' disabled' : '') + '>' + (item.suit ? SYMBOLS[item.suit] + ' ' + rankLabel(game.match.dealer >= 0 ? game.trumpRank : game.match.levels[viewer % 2]) + (item.strength === 2 ? ' 一对' : ' 单张') : item.strength === 4 ? '大王对 · 无主' : '小王对 · 无主') + '</button>').join('') + '</div>' : '<div class="turn-notice">发牌与亮主同步进行。</div>';
  else if (myTurn && decision.phase === 'declare') actions = '<div class="bid-options"><button class="secondary" data-bid="pass">本次不亮</button>' + decision.options.map((item) => '<button class="secondary gold" data-bid="' + item.id + '">' + (item.suit ? SYMBOLS[item.suit] + ' ' + rankLabel(game.hand.find((card) => card.suit === item.suit && card.rank === (game.match.dealer >= 0 ? game.trumpRank : game.match.levels[viewer % 2]))?.rank || game.trumpRank) + (item.strength === 2 ? ' 一对' : ' 单张') : item.strength === 4 ? '大王对 · 无主' : '小王对 · 无主') + '</button>').join('') + '</div>';
  else if (myTurn && decision.phase === 'rebel') actions = '<div class="bid-options"><button class="primary" id="acceptRebel">重新发牌</button><button class="secondary" id="declineRebel">继续打</button></div>';
  else if (playing) {
    const error = selectionError(game, [...selected]);
    const collecting = !!tableMotion && game.phase === 'play';
    actions = '<div class="hand-actions"><span class="turn-message"><b>' + (collecting ? '上一墩收牌中 · 可以先选牌' : decision.phase === 'bury' ? '扣下八张底牌' : decision.phase === 'lead' ? '轮到你领出' : '跟 ' + game.plays[0].cards.length + ' 张牌') + '</b><small>' + (selected.size ? '已选 ' + selected.size + ' 张 · ' + escape(error || (collecting ? '收牌后可出' : decision.phase === 'bury' ? '可以扣底' : '可以出牌')) : '点选手牌，双击选同牌对子') + '</small></span><button class="secondary" id="suggest">帮我选牌</button><button class="quiet" id="clearSelection"' + (!selected.size ? ' disabled' : '') + '>清空</button><button class="primary" id="playCards"' + (error || collecting ? ' disabled' : '') + '>' + (decision.phase === 'bury' ? '确认扣底' : collecting ? '收牌中…' : '出牌') + '<span class="key-hint">↵</span></button></div>';
  }
  else actions = '<div class="turn-notice">' + (latest.paused ? '牌局已暂停，点击上方「继续」。' : decision ? '等待 ' + escape(game.seats[decision.seat].name) + (latest.busy ? ' 决策…' : ' 出牌') : '本局结束，可以查看记录或继续下一局。') + '</div>';
  return '<div class="hand-panel" id="handPanel"><div class="hand-header">' + (viewer < 0 ? '公开观战视角' : escape(game.seats[viewer].name) + '的手牌') + '<span>' + (viewer < 0 ? '不显示任何私有手牌' : game.hand.length + ' 张 · ' + (viewer % 2 ? '东西队' : '南北队')) + '</span></div><div class="hand" id="playerHand" role="group" aria-label="你的手牌">' + (game.hand.length ? game.hand.map((card) => handCard(card, playing, game)).join('') : '<div class="empty-hand">—</div>') + '</div><p class="hand-scroll-hint">左右滑动查看手牌 <span>· 方向键移动，空格选牌，Shift 连选</span></p>' +
    (selected.size ? '<div class="selection-preview" aria-label="已选手牌"><span>已选</span>' + game.hand.filter(card => selected.has(card.id)).map(card => '<span class="selection-chip' + (['H', 'D'].includes(card.suit) ? ' red' : '') + '">' + escape(cardLabel(card)) + '</span>').join('') + '</div>' : '') + actions +
    (game.buriedKnown.length && !game.score ? '<p class="fine">你扣下的底牌：' + game.buriedKnown.map(cardLabel).map(escape).join('　') + '</p>' : '') + '</div>';
}
function render() {
  const game = latest?.game;
  clearTimeout(motionTimer);
  tableMotion = trickFlow.update(game, { now: performance.now(), paused: latest?.paused, reducedMotion: motionPreference.matches, hidden: document.hidden });
  if (tableMotion) motionTimer = setTimeout(render, tableMotion.remaining + 1);
  document.body.classList.toggle('in-game', !!game);
  $('connectionLabel').textContent = connected ? '本地已连接' : '正在重连…';
  $('connectionLabel').parentElement.classList.toggle('disconnected', !connected);
  if (game && presentedGame !== game.id) { $('setupPanel').open = false; presentedGame = game.id; }
  const disabled = !connected || submitting ? ' disabled' : '';
  $('apiConnectionCount').textContent = (latest?.connections || []).filter(p => p.active).length + ' 已启用';
  patchHtml($('toolbar'), '<span class="round-label">' + (game ? '第 ' + String(game.score ? game.match.round : game.match.round + 1).padStart(2, '0') + ' 局 · 南北 ' + rankLabel(game.match.levels[0]) + ' / 东西 ' + rankLabel(game.match.levels[1]) : 'SHANGHAI · 四人升级') + '</span>' +
    (game ? '<div class="tools"><button id="restartGame" class="restart-button"' + disabled + '>重新开始</button><button id="nextGame"' + (game.phase !== 'round_over' || !connected ? ' disabled' : '') + '>下一局</button><button id="pauseGame"' + disabled + '>' + (latest.paused ? '继续' : '暂停') + '</button>' + (viewer >= 0 ? '<button id="autoplay"' + disabled + '>' + (latest.autoplay.includes(viewer) ? '收回托管' : '托管') + '</button>' : '') + '<button id="lastTrick"' + (!game.tricks.length ? ' disabled' : '') + '>上一墩 ↗</button><a href="/api/replay?seat=' + viewer + '" download>牌谱 ↓</a></div>' : ''));
  const statusMessage = !connected ? '连接暂时中断，正在重连。离开超过 5 秒后，单人牌桌会自动暂停。' : latest?.paused ? (latest.pauseReason === 'away' ? '你刚才离开了牌桌，已为你暂停。准备好后点击「继续」。' : latest.pauseReason === 'credentials' ? 'API 配置已更新，确认后点击「继续」。' : latest.pauseReason === 'expired' ? '会话空闲时间较长，key 已清除。可重新启用 API 或用陪练继续。' : latest.pauseReason === 'restored' ? '已恢复牌局；API key 需要重新启用。点击「继续」也可由陪练接手。' : '牌局已暂停。') : game && latest.autoplay.includes(viewer) ? '陪练正在替你打牌。点击「收回托管」即可接手。' : submitting ? '正在提交…' : '';
  $('tableStatus').textContent = statusMessage; $('tableStatus').hidden = !statusMessage;
  const announcement = tableMotion ? seatLabel(game, tableMotion.trick.winner) + '收下本墩，' + tableMotion.trick.points + ' 分。' : game?.pending?.seat === viewer ? ({ bury: '轮到你扣底，请选八张牌。', lead: '轮到你领出。', follow: '轮到你跟牌。', declare: '可以选择亮主或本次不亮。', rebel: '请选择是否重新发牌。' })[game.pending.phase] : game?.phase === 'closing' ? '还有人反主吗？请在倒计时结束前亮主。' : '';
  if ($('turnAnnouncement').textContent !== announcement) $('turnAnnouncement').textContent = announcement || '';
  const result = game?.score ? '<section class="results"><h2>' + (game.match.winner >= 0 ? (game.match.winner ? '东西队' : '南北队') + ' 赢得本场' : game.score.attackersWin ? '闲家上台' : '庄家守住了') + '</h2><p>闲家得分 ' + game.score.total + '。牌面 ' + game.score.attackPoints + ' 分，底牌 ' + game.score.kittyPoints + ' 分，抠底倍数 ×' + game.score.multiplier + '。<br>' + (game.tricks.at(-1).winner % 2 !== game.dealer % 2 ? '闲家赢了最后一墩，计入抠底分。' : '庄家方赢了最后一墩，底牌不计入闲家得分。') + '<br>' + (game.match.gateHeld ? '仍须在 ' + rankLabel(game.match.gateHeld) + ' 这一关坐庄守住。' : '本局升级 ' + game.score.levelsUp + ' 级，实际级数按关卡规则计算。') + '<br>底牌：' + game.kitty.map(cardLabel).map(escape).join('　') + '</p>' + (game.phase === 'round_over' ? '<button class="primary" id="nextDeal">下一局 · ' + escape(game.seats[game.match.dealer].name) + ' 坐庄 →</button>' : '<p class="fine">在「四席入座」开始新牌桌，再来一场。</p>') + '</section>' : '';
  patchHtml($('gameArea'), tableOverview(game, tableMotion) + gameTable(game) +
    (game ? '<div class="score-strip"><div class="score-meter"><span class="team-score">闲家得分 <b>' + (game.score?.total ?? game.attackPoints) + '</b></span><progress value="' + Math.min(game.score?.total ?? game.attackPoints, 80) + '" max="80" aria-label="闲家距离八十分的进度"></progress><span class="target">80 分上台</span></div>' + lastTrickSummary(game, tableMotion) + '</div>' : '') +
    result + handPanel(game));
  if (!sceneStarting) { sceneStarting = true; createTableScene($('tableScene'), depthEnabled).then(value => { scene = value; scene.setEnabled(depthEnabled); }); }
  if (scene) $('cardTable').dataset.scene = $('tableScene').dataset.renderer;
  $('cardTable').style.setProperty('--flip-duration', TRICK_TIMING.flip + 'ms');
  $('cardTable').style.setProperty('--collect-duration', TRICK_TIMING.collect + 'ms');
  const flight = document.querySelector('.deal-flight');
  if (flight) flight.style.animationDelay = '-' + Math.max(0, Date.now() - latest.dealClock.lastDrawAt) + 'ms';
  updateThinkingClock();
  if ($('quickStart')) $('quickStart').onclick = () => $('startGame').click();
  if ($('pauseGame')) $('pauseGame').onclick = () => post('pause', { paused: !latest.paused }).catch((error) => notify(error.message));
  if ($('autoplay')) $('autoplay').onclick = () => post('autoplay', { seat: viewer, enabled: !latest.autoplay.includes(viewer) }).catch((error) => notify(error.message));
  const next = () => { quiz = null; quizKey = null; post('next', {}).catch(error => notify(error.message)); };
  if ($('nextDeal')) $('nextDeal').onclick = next;
  if ($('nextGame')) $('nextGame').onclick = next;
  if ($('restartGame')) $('restartGame').onclick = () => $('restartDialog').showModal();
  const review = index => {
    if (tableScope(game) !== tableScope(latest.game)) return;
    const trick = game.tricks[index] || (index === game.tricks.length ? { index, plays: game.plays } : null);
    if (!trick?.plays.length) return;
    $('trickContent').innerHTML = '<span class="eyebrow">第 ' + (index + 1) + ' 墩 · ' + (trick.winner === undefined ? '截至打开时的出牌' : '公开记录') + '</span><h2>' + (trick.winner === undefined ? '本墩进行中' : escape(seatLabel(game, trick.winner)) + ' 收下 · ' + trick.points + ' 分') + '</h2>' + trick.plays.map((play, order) => '<div class="trick-review"><span>' + escape(seatLabel(game, play.seat)) + '<small>' + (play.seat === trick.winner ? '收牌 · ' : '') + (order === 0 ? '领出' : '跟牌') + ' · ' + play.cards.length + ' 张</small></span><div>' + play.cards.map(mini).join('') + '</div></div>').join('');
    $('trickDialog').showModal();
  };
  if ($('lastTrick')) $('lastTrick').onclick = () => review(game.tricks.length - 1);
  document.querySelectorAll('[data-review-trick]').forEach(button => button.onclick = () => review(Number(button.dataset.reviewTrick)));
  if ($('handoff')) $('handoff').onclick = () => { viewer = game.pending.seat; quiz = null; quizKey = null; connect(); };
  document.querySelectorAll('[data-card]').forEach((button) => {
    button.onclick = event => {
      const id = Number(button.dataset.card); focusCard = id;
      if (event.shiftKey) selected = selectRange(game.hand, selected, anchor, id);
      else { selected.has(id) ? selected.delete(id) : selected.add(id); anchor = id; }
      render();
    };
    button.ondblclick = () => { selected = selectPair(game.hand, selected, Number(button.dataset.card)); render(); };
    button.onfocus = () => { focusCard = Number(button.dataset.card); document.querySelectorAll('[data-card]').forEach(c => c.tabIndex = c === button ? 0 : -1); };
  });
  document.querySelectorAll('[data-bid]').forEach((button) => button.onclick = () => act({ type: 'declare', choice: button.dataset.bid }, game.bidContext));
  if ($('acceptRebel')) $('acceptRebel').onclick = () => act({ type: 'rebel', accept: true });
  if ($('declineRebel')) $('declineRebel').onclick = () => act({ type: 'rebel', accept: false });
  if ($('playCards')) $('playCards').onclick = () => act({ type: game.pending.phase === 'bury' ? 'bury' : 'play', cardIds: [...selected] });
  if ($('clearSelection')) $('clearSelection').onclick = () => { selected.clear(); render(); };
  if ($('suggest')) $('suggest').onclick = () => {
    const cards = game.pending.phase === 'bury' ? game.hand.slice(-8) : game.pending.phase === 'follow' ? safeFollow(game.hand, classify(game.plays[0].cards, game.trump), game.trump, game.rules) : [game.hand.at(-1)];
    selected = new Set(cards.map((card) => card.id)); render();
  };
  const labels = { declaration: '亮主', pass: '不亮', throw_failed: '甩牌未成立，改出最小组件', rebel_choice: '重发选择', trump_set: '定主', buried: '扣底', deal_started: '新一局' };
  const dealStart = game?.events.findLast((event) => event.type === 'deal_started')?.seq ?? -1;
  const records = game?.events.filter((event) => event.seq >= dealStart && (labels[event.type] || event.type === 'trick')) || [];
  const historyTop = $('history').scrollTop, historyHeight = $('history').scrollHeight;
  patchHtml($('history'), records.length ? records.slice(-35).reverse().map((event) => '<div class="history-row" data-key="event-' + event.seq + '"><span class="number">' + (event.type === 'trick' ? String(event.index + 1).padStart(2, '0') : '·') + '</span><span class="record">' +
    (event.type === 'trick' ? escape(game.seats[event.winner].name) + ' 收下本墩 · ' + (game.tricks[event.index]?.plays.map((play) => game.seats[play.seat].name + ' ' + play.cards.map(cardLabel).join(' ')).map(escape).join(' / ') || '') :
      (event.seat !== undefined ? escape(game.seats[event.seat].name) + ' · ' : '') + labels[event.type] + (event.type === 'declaration' ? ' ' + (event.suit ? SYMBOLS[event.suit] : '无主') + (event.strength > 1 ? ' 对' : '') : '')) +
    '</span>' + (event.type === 'trick' ? '<span class="points">+' + event.points + ' 分</span>' : '') + '</div>').join('') : '<div class="empty-hand">开始牌局后，这里会记录亮主、出牌与每一墩的结果。</div>');
  if (historyTop > 0) $('history').scrollTop = historyTop + $('history').scrollHeight - historyHeight;
  const hand = document.querySelector('.hand');
  const cards = hand?.querySelectorAll('.card');
  if (cards?.length > 1) {
    const width = cards[0].offsetWidth;
    const step = Math.max(matchMedia('(pointer: coarse)').matches ? 34 : 29, Math.min(width - 4, (hand.clientWidth - 16 - width) / (cards.length - 1)));
    cards.forEach((card, index) => { card.style.marginRight = index === cards.length - 1 ? '0px' : (step - width) + 'px'; });
  }
  renderStats(); renderTraining(game);
  if (latest?.archives?.length) $('metrics').insertAdjacentHTML('beforeend', '<details class="archives"><summary>此前牌桌用量 · 最近 ' + latest.archives.length + ' 桌</summary>' + latest.archives.slice().reverse().map(a => '<div class="archive-row">' + escape(a.at.slice(0, 16).replace('T', ' ')) + (a.completed ? ' · 已完成' : ' · 已重开') + '<br>' + a.requests + ' 次请求 · ' + a.input + ' 输入 / ' + a.output + ' 输出 tokens<br>已知估算 $' + a.cost.toFixed(6) + ' · 未知用量 ' + a.unknown + ' · 待回执 ' + a.pending + '</div>').join('') + '</details>');
}
async function act(action, bidContext = null) {
  if (submitting || !connected || action.type === 'play' && tableMotion) return;
  const game = latest.game;
  const actingViewer = viewer;
  const envelope = bidContext ? { seat: viewer, bidContext, action } : { decisionId: game.pending.id, version: game.version, seat: viewer, action };
  submitting = true; render();
  try {
    await post('action', envelope); selected.clear();
    const next = await fetch('/api/state?seat=' + actingViewer).then(response => response.json());
    if (viewer === actingViewer && latest?.game?.id === game.id) receive(next);
  }
  catch (error) { notify(error.message); }
  finally { submitting = false; render(); }
}
function renderStats() {
  if (latest?.statsDeferred) { $('metrics').innerHTML = '<p class="fine">本局用量、耗时与代打记录将在结束后公开，避免泄露谁有机会叫主。后台仍完整记录每次调用。</p><p class="fine">本桌请求上限 ' + (latest.config?.limits.maxRequests ?? 100) + ' 次 · 单次决策最多 12 秒</p>'; return; }
  const stats = latest?.stats || {};
  $('metrics').innerHTML = '<div class="stat-grid">' +
    [['真实 API 请求', stats.realRequests || 0, '次'], ['离线模拟决策', stats.simulated || 0, '次'], ['已报告输入 / 输出', (stats.input || 0).toLocaleString() + ' / ' + (stats.output || 0).toLocaleString(), 'tokens'], ['API 请求平均耗时', stats.latencyCount ? Math.round(stats.mean) : '—', 'ms'], ['API 请求中位耗时', stats.latencyCount ? Math.round(stats.p50) : '—', 'ms'], ['API 请求 P95 耗时', stats.latencyCount ? Math.round(stats.p95) : '—', 'ms']].map(([label, value, unit]) => '<div class="stat"><small>' + label + '</small><strong>' + value + '</strong> <em>' + unit + '</em></div>').join('') +
    '</div><div class="audit-status">最近 ' + (stats.latencyCount || 0) + ' 次有耗时记录的 API 请求，含失败与超时<br>' + (latest?.game ? '无需决策而跳过 ' + latest.game.forcedPasses + ' 次亮主机会<br>' : '') + '异常 ' + (stats.errors || 0) + ' · 陪练代打 ' + (stats.fallbacks || 0) + ' · 用量未知 ' + (stats.usageUnknown || 0) + ' · 已报告缓存输入 ' + (stats.cached || 0) + ' · 缓存未知 ' + (stats.cacheUnknown || 0) +
    '<br>已报告推理 ' + (stats.reasoning || 0) + ' tokens（已含在输出中）' +
    (stats.referencePricedRequests ? '<br>标准价参考 $' + Number(stats.referenceCostUsd || 0).toFixed(6) + ' · ' + stats.referencePricedRequests + ' 次已计价请求（非账单；包含套餐参考价或自填价，未含缓存优惠）' : '<br>费用：暂无可计价的实际响应') + '</div>' +
    (latest?.logs.findLast((entry) => entry.fallback) ? '<p class="fine warning">最近一次陪练代打：' + escape(latest.logs.findLast((entry) => entry.fallback).reason) + '</p>' : '') +
    (latest?.logs.at(-1)?.error ? '<p class="fine warning">' + escape(latest.logs.at(-1).error) + '</p>' : '') + (latest?.game?.score ? '<p class="fine"><a href="/api/audit" download>导出用量记录</a></p>' : '');
}
function renderTraining(game) {
  if (!$('trainingToggle').checked) return;
  if (game?.pending && game.seats[game.pending.seat].kind === 'human' && game.pending.seat !== viewer && game.seats.filter((seat) => seat.kind === 'human').length > 1) {
    quiz = null; quizKey = null;
    $('training').innerHTML = '<p class="fine">完成手牌交接后，再显示当前玩家的练习。</p>';
    return;
  }
  if (!game?.tricks.length || viewer < 0 || game.viewer !== viewer) { $('training').innerHTML = '<p class="fine">至少完成一墩后，练习会出现在这里。观战视角不进行私有信息练习。</p>'; return; }
  const key = game.id + ':' + game.match.round + ':' + game.tricks.length + ':' + viewer;
  if (!quiz || quizAnswered && quizKey !== key) { quiz = trainingQuestion(game); quizKey = key; quizAnswered = false; quizSelection.clear(); }
  if (!quiz) return;
  patchHtml($('training'), '<span class="quiz-title">' + escape(quiz.title) + '</span><p class="quiz-question">' + escape(quiz.question) + (quiz.multiple ? '（可多选）' : '') + '</p><div class="quiz-options">' +
    quiz.options.map((answer, index) => '<button class="quiz-choice' + (quizSelection.has(answer) ? ' selected' : '') + '" data-answer="' + index + '"' + (quizAnswered ? ' disabled' : '') + '>' + escape(answer) + '</button>').join('') + '</div>' +
    (quizAnswered ? '<p class="quiz-answer">' + (JSON.stringify([...quizSelection].sort()) === JSON.stringify([...quiz.correct].sort()) ? '答对了。' : '答案：' + quiz.correct.map(escape).join('、') + '。') + escape(quiz.explanation) + '</p>' : '<div class="hand-actions"><button class="secondary" id="answerQuiz">检查答案</button><button class="quiet" id="skipQuiz">看解析</button></div>'));
  document.querySelectorAll('[data-answer]').forEach((button) => button.onclick = () => {
    const answer = quiz.options[Number(button.dataset.answer)];
    if (!quiz.multiple) quizSelection.clear();
    if (quizSelection.has(answer)) quizSelection.delete(answer); else quizSelection.add(answer);
    renderTraining(game);
  });
  if ($('answerQuiz')) $('answerQuiz').onclick = () => { quizAnswered = true; renderTraining(game); };
  if ($('skipQuiz')) $('skipQuiz').onclick = () => { quizAnswered = true; quizSelection.clear(); renderTraining(game); };
}
$('trainingToggle').onchange = (event) => {
  quiz = null; quizKey = null;
  if (event.target.checked) renderTraining(latest?.game);
  else $('training').innerHTML = '<p class="fine">开启后，在牌局中回答断门与大牌问题。练习在本地运行，不增加 API 请求。</p>';
};
$('rulesButton').onclick = () => $('rulesDialog').showModal();
$('closeRules').onclick = () => $('rulesDialog').close();
$('closeTrick').onclick = () => $('trickDialog').close();
$('depthToggle').checked = depthEnabled;
$('depthToggle').onchange = event => {
  depthEnabled = event.target.checked; scene?.setEnabled(depthEnabled);
  try { localStorage.setItem('eighty-depth', depthEnabled ? 'on' : 'off'); } catch {}
};
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || event.target.matches('input,select,textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.matches('[data-card]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    const cards = [...document.querySelectorAll('[data-card]:not(:disabled)')], at = cards.indexOf(event.target);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : Math.max(0, Math.min(cards.length - 1, at + (event.key === 'ArrowLeft' ? -1 : 1)));
    if (!cards[index]) return;
    event.preventDefault(); const id = Number(cards[index].dataset.card);
    if (event.shiftKey) { selected = selectRange(latest.game.hand, selected, anchor ?? Number(event.target.dataset.card), id); render(); }
    cards[index].focus(); return;
  }
  if (event.key === 'Escape' && selected.size) { selected.clear(); render(); }
  if (event.key === 'Enter' && event.target.closest('#handPanel') && $('playCards') && !$('playCards').disabled && !event.target.matches('button:not([data-card])')) {
    event.preventDefault(); $('playCards').click();
  }
});
let resizeFrame;
window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(render); });
setupConnectionsDialog({ state: () => latest, post, refresh: refreshState, notify });
$('closeRestart').onclick = $('cancelRestart').onclick = () => $('restartDialog').close();
$('confirmRestart').onclick = async () => {
  $('confirmRestart').disabled = true;
  try { await post('restart', {}); $('restartDialog').close(); await refreshState(); }
  catch (error) { notify(error.message); }
  finally { $('confirmRestart').disabled = false; }
};
renderSetup(); render();
try {
  const initial = await fetch('/api/state?seat=-1').then((response) => response.json());
  status = initial.providers; latest = initial; csrfToken = initial.csrf || '';
  if (initial.game) viewer = initial.game.seats.findIndex((seat) => seat.kind === 'human');
  renderSetup(); connect();
} catch (error) { connect(); render(); notify('本地服务暂未连接，正在重试。'); }
