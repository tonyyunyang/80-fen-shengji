import { kimiCodeRequestOptions } from '/src/model-catalog.js';
import { errorText } from './errors.js';
import { renderNotebook } from './notebook-view.js';
import { detailedRules } from './rules-guide.js';
import { t, pick, locale, rankLabel, cardLabel, cardCount, seatName, localizeStaticDocument } from './i18n.js';
import { SYMBOLS, points } from '/src/cards.js';
import { classify, safeFollow } from '/src/rules.js';
import { trainingQuestion } from '/src/training.js';
import { decisionTimeoutMs, MAX_DECISION_MS, DEAL_INTERVAL_MS } from '/src/player-settings.js';
import { DEFAULT_PREFERENCES, readPreferences } from './preferences.js';
import { createTableSound } from './table-sound.js';
import { createTableMusic } from './table-music.js';
import { UI_LABELS } from './ui-labels.js';
import { setupSeatRows } from './seat-setup.js';
import { acceptSnapshot, isHumanTurn } from './client-state.js';
import { createAtmosphere } from './atmosphere.js';
import { createTableEffects } from './table-effects.js';
import { patchHtml, escapeHtml as escape } from './dom.js';
import { cardFace, cardBack } from './card-art.js';
import { createHandHover } from './hand-hover.js';
import { wordmark } from './wordmark.js';
import { enhanceDialogs } from './dialogs.js';
import { createHandDrag } from './hand-drag.js';
import { handLayout } from './hand-layout.js';
import { tableLayout, fanOverlap, initialSceneScale, fitScene } from './table-layout.js';
import { createDealMotion } from './deal-motion.js';
import { selectionError, selectRange, selectPair, dragCardIds } from './hand-tools.js';
import { apiSeatFields, connectionFor, setupConnectionsDialog } from './connections-ui.js';
import { TrickFlow } from './table-flow.js';
import {
  mini,
  pixelSeat,
  dealMarkers,
  deckMarkup,
  closingClock,
  trickMarkup,
  resultMarkup,
  seatLabel,
  levelLabel,
  playerName,
  arrivingCard,
  declarationMarkup,
  displayedDeclarations,
} from './pixel-view.js';

localizeStaticDocument();
const $ = (id) => document.getElementById(id),
  directions = [t('南'), t('东'), t('北'), t('西')];
const typeName = (seat) => {
  if (seat.kind === 'human') return t('人类玩家');
  if (seat.kind === 'peilian') return t('陪练');
  if (seat.provider === 'mock') return t('离线模拟');
  const profile = connectionFor(seat, latest?.connections || []),
    model = profile?.models.find((m) => m.id === seat.model);
  return profile?.active && model
    ? (kimiCodeRequestOptions(seat.model, profile?.baseUrl, 512)
        ? pick('Kimi · 快速', 'Kimi · fast')
        : model.label || seat.model) + ' · AI'
    : pick('陪练 · API 未启用', 'Practice bot · API inactive');
};
const defaultSeats = () =>
  directions.map((direction, index) => ({
    name: index === 0 ? t('你') : direction + t('家'),
    kind: index ? 'peilian' : 'human',
    provider: 'mock',
    model: '',
  }));
const setupDefaultsVersion = 4;
let config = {
  setupDefaultsVersion,
  seats: defaultSeats(),
  rules: { gates: true, fullRebel: 'off', speedRun: false, partialTractorFollow: true },
  limits: { maxRequests: 100 },
  speed: 600,
};
let appearance = { ...DEFAULT_PREFERENCES };
let hasSavedSetup = false;
const sound = createTableSound(() => appearance);
function musicStatus(state) {
  const statuses = {
    off: ['可在这里开启，菜单与牌局之间连续播放。', 'Enable it here; the track continues between menus and play.'],
    waiting: ['点击页面后开始播放。', 'Interact with the page to start playback.'],
    loading: ['正在加载音乐…', 'Loading music…'],
    playing: ['正在播放。', 'Playing.'],
    paused: ['已暂停，回来后接着播放。', 'Paused; continues when you return.'],
    unavailable: ['音乐暂时不可用，可重新开启再试。', 'Music is unavailable. Toggle it on again to retry.'],
  };
  $('musicStatus').textContent = pick('八十分之后 · 原创配乐。', 'After Eighty · Original soundtrack. ') + pick(...statuses[state]);
}
const music = createTableMusic(() => appearance, { getContext: sound.getContext, onStatus: musicStatus });
sound.onUnlock(() => music.sync());
sound.onPlay(kind => music.duck(kind));
try {
  const stored = JSON.parse(localStorage.getItem('eighty-config'));
  if (
    stored?.seats?.length === 4 &&
    stored.seats.every((seat) => seat && ['human', 'api', 'peilian'].includes(seat.kind))
  )
    { config = { ...config, ...stored }; hasSavedSetup = true; }
  const options = JSON.parse(localStorage.getItem('eighty-pixel-options'));
  appearance = readPreferences(options);
} catch {}
// The old default was 500 ms. Migrate that default once, without resetting
// seats, personal connections, or an explicit slow setting. Future 500 ms
// selections carry the version marker and stay selected.
if (config.dealPaceVersion !== 1) {
  if (config.dealIntervalMs == null || Number(config.dealIntervalMs) === 500) config.dealIntervalMs = DEAL_INTERVAL_MS;
  config.dealPaceVersion = 1;
}
for (const seat of config.seats) {
  delete seat.referenceAdvice;
  if (seat.kind === 'api') seat.promptLanguage = seat.promptLanguage === 'en' ? 'en' : 'zh';
}
config.rules = {
  gates: true,
  fullRebel: 'off',
  speedRun: false,
  partialTractorFollow: true,
  ...config.rules,
  firstDealer: 'random',
};
try {
  config.limits = { ...config.limits, timeoutMs: decisionTimeoutMs(config.limits?.timeoutMs) };
} catch {
  config.limits = { maxRequests: 100, timeoutMs: 12000 };
}
let status = { mock: true, openai: false, claude: false, qwen: false },
  latest = null,
  viewer = 0,
  stream,
  selected = new Set(),
  lastDecision = null,
  noticeTimer;
let socketHeartbeat=null, socketPresence=null, reconnectTimer=null;
let quiz = null,
  quizKey = null,
  quizSelection = new Set(),
  quizAnswered = false;
let arriving = null,
  recalled = new Map();
let csrfToken = '',
  reconnecting = false,
  connected = false,
  submitting = false,
  starting = false,
  anchor = null,
  focusCard = null;
let viewMode = 'menu',
  handHover = null,
  handHoverRoot = null,
  handDrag = null,
  handResize = null,
  tableMotion = null,
  motionTimer,
  bookTab = 'notebook',
  rulesReturn = 'menu';
const clientId = crypto.randomUUID(),
  trickFlow = new TrickFlow(),
  motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const atmosphere = createAtmosphere($('atmosphere'));
const dealMotion = createDealMotion({back:cardBack});
const tableEffects = createTableEffects({
  preferences: () => appearance,
  sound,
  reducedMotion: () => motionPreference.matches,
});
const text = (id, zh, en) => {
  $(id).textContent = pick(zh, en);
};
function notify(message) {
  $('notice').textContent = errorText(message);
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => ($('notice').hidden = true), 5500);
}
async function post(path, data) {
  const response = await fetch('/api/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-eighty-csrf': csrfToken },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(errorText(result.error) || t('请求失败'));
  return result;
}
function option(value, label, current, disabled = false) {
  return (
    '<option value="' +
    escape(value) +
    '"' +
    (value === current ? ' selected' : '') +
    (disabled ? ' disabled' : '') +
    '>' +
    escape(label) +
    '</option>'
  );
}
function renderSetup() {
  $('apiConnectionCount').textContent = latest?.connections?.length ? String(latest.connections.length) : '';
  const rows = setupSeatRows(config.seats);
  const humanCount = config.seats.filter((seat) => seat.kind === 'human').length;
  for (const row of rows) {
    const node = document.querySelector('.compass-' + row.position);
    node.textContent = row.label;
    node.title = row.hint;
  }
  $('setupPerspective').textContent = humanCount
    ? (humanCount > 1 ? pick('以第一位真人的视角安排。', 'Shown from the first human’s view. ') : '') +
      pick(
        '你在下方，队友在对面；左侧是上家对手，右侧是下家对手。',
        'You sit at the bottom, your teammate across, and opponents to your left and right.',
      )
    : pick(
        '观战模式：上下两家一队，左右两家一队。',
        'Spectator view: top and bottom are partners; left and right form the other team.',
      );
  const opened = [...$('setup').querySelectorAll('details[open]')].map((node) => node.id),
    focus = document.activeElement?.id;
  $('setup').innerHTML =
    rows
      .map(({ index, team, marker, label, hint }) => {
        const seat = config.seats[index];
        return (
          '<div class="seat-form"><div class="seat-letter team-' +
          team +
          '" aria-hidden="true">' +
          marker +
          '</div><div><label class="setup-seat-heading" for="kind-' +
          index +
          '">' +
          escape(label) +
          '</label><p class="setup-seat-position" id="position-' +
          index +
          '">' +
          escape(hint) +
          '</p><select id="kind-' +
          index +
          '" aria-describedby="position-' +
          index +
          '">' +
          option('human', t('人类玩家'), seat.kind) +
          option('peilian', t('陪练 · 本地策略'), seat.kind) +
          option('api', t('API 模型'), seat.kind) +
          '</select></div>' +
          (seat.kind === 'api' ? apiSeatFields(seat, index, latest?.connections || [], label + ' · ' + hint, latest?.capabilities) : '') +
          '</div>'
        );
      })
      .join('') +
    t(
      '<div class="presets"><button class="preset" id="apiPreset">一人 · 三 API</button><button class="preset" id="practicePreset">一人 · 三陪练</button><button class="preset" id="mixedPreset">两席离线模拟</button><button class="preset" id="watchPreset">四席观战</button></div>',
    ) +
    t('<details class="options" id="tableOptions"><summary>牌桌设置</summary>') +
    t('<label class="option-row">必打 2 / 5 / 10 / K<input id="gates" type="checkbox"') +
    (config.rules.gates !== false ? ' checked' : '') +
    '></label>' +
    t('<label class="option-row">速通阶梯<input id="speedRun" type="checkbox"') +
    (config.rules.speedRun ? ' checked' : '') +
    '></label>' +
    t('<label class="option-row">有短拖拉机也须跟<input id="partial" type="checkbox"') +
    (config.rules.partialTractorFollow !== false ? ' checked' : '') +
    '></label>' +
    t('<label class="option-row">低分 / 少主重发<select id="rebel">') +
    option('off', t('关闭'), config.rules.fullRebel) +
    option('redeal', t('仅重新发牌'), config.rules.fullRebel) +
    option('scramble', t('重发并重新抢庄'), config.rules.fullRebel) +
    '</select></label>' +
    t('<label class="option-row">发牌节奏<select id="dealSpeed">') +
    option('250', pick('快速 · 每人每 1 秒一张', 'Quick · one card per player each second'), String(config.dealIntervalMs || DEAL_INTERVAL_MS)) +
    option('500', t('从容 · 每人每 2 秒一张'), String(config.dealIntervalMs || DEAL_INTERVAL_MS)) +
    option('700', t('慢速 · 每人每 2.8 秒一张'), String(config.dealIntervalMs || DEAL_INTERVAL_MS)) +
    '</select></label>' +
    t('<label class="option-row">机器出牌节奏<select id="speed">') +
    option('600', t('从容 · 600ms'), String(config.speed)) +
    option('1200', t('慢速 · 1.2s'), String(config.speed)) +
    option('100', t('快速 · 100ms'), String(config.speed)) +
    '</select></label>' +
    t('<label class="option-row">本桌 API 请求上限<input id="requestLimit" type="number" min="0" max="2000" value="') +
    escape(config.limits.maxRequests) +
    t('"></label><p class="fine">设为 0 时，API 席全部由陪练代打，不发送请求。</p>') +
    t('<label class="option-row">单次输出上限<input id="outputLimit" type="number" min="128" max="4096" value="') +
    (config.limits.maxOutput || 512) +
    '"></label>' +
    t('<label class="option-row">API 决策限时（含重试）<input id="timeoutLimit" type="number" min="1" max="') +
    MAX_DECISION_MS / 1000 +
    '" value="' +
    config.limits.timeoutMs / 1000 +
    t(
      '" aria-label="API 决策最长等待秒数"></label><p class="fine">最多等待 12 秒，超时由陪练代打本次。下一次仍优先使用 API。</p></details>',
    ) +
    (latest?.restoreAvailable && !latest.game
      ? t('<button class="secondary restore-local" id="restoreLocal">继续此前的本地牌局</button>')
      : '') +
    '<button class="primary start" id="startGame"' +
    (!csrfToken ? ' disabled' : '') +
    '><span>' +
    (latest?.game ? t('开始新牌桌') : t('开始牌局')) +
    '</span><span>→</span></button>' +
    '<p class="fine">' +
    pick(
      '首局随机选庄，亮主只决定主花色。选择好四个座位后再发牌。',
      'The first dealer is chosen randomly; declarations choose the trump suit. Set all four seats before dealing.',
    ) +
    '</p>';
  for (const id of opened) if ($(id)) $(id).open = true;
  if (focus && $('setup').contains($(focus))) $(focus).focus({ preventScroll: true });
  config.seats.forEach((seat, index) => {
    if ($('endgame-' + index))
      $('endgame-' + index).onchange = (event) => {
        config.seats[index].endgameAnalysis = event.target.checked;
        storeConfig();
      };
    if ($('prompt-language-' + index))
      $('prompt-language-' + index).onchange = (event) => {
        config.seats[index].promptLanguage = event.target.value;
        storeConfig();
      };
    $('kind-' + index).onchange = (event) => {
      config.seats[index].kind = event.target.value;
      if (event.target.value === 'api') {
        const profile = connectionFor(config.seats[index], latest?.connections || []) || latest?.connections?.[0];
        const model = profile?.models.some((model) => model.id === config.seats[index].model)
          ? config.seats[index].model
          : '';
        config.seats[index].provider = profile?.provider || 'qwen';
        config.seats[index].connectionId = profile?.id;
        config.seats[index].model = model;
        config.seats[index].promptLanguage ??= 'zh';
      }
      storeConfig();
      renderSetup();
    };
    if ($('provider-' + index))
      $('provider-' + index).onchange = (event) => {
        const profile = latest.connections.find((p) => p.id === event.target.value);
        config.seats[index].provider = profile?.provider || 'mock';
        config.seats[index].connectionId = profile?.id;
        config.seats[index].model = '';
        storeConfig();
        renderSetup();
      };
    if ($('model-' + index)) {
      const update = (event) => {
        config.seats[index].model = event.target.value;
        storeConfig();
        renderSetup();
      };
      $('model-' + index).onchange = update;
    }
  });
  $('gates').onchange = (event) => {
    config.rules.gates = event.target.checked;
    storeConfig();
  };
  $('speedRun').onchange = (event) => {
    config.rules.speedRun = event.target.checked;
    storeConfig();
  };
  $('partial').onchange = (event) => {
    config.rules.partialTractorFollow = event.target.checked;
    storeConfig();
  };
  $('rebel').onchange = (event) => {
    config.rules.fullRebel = event.target.value;
    storeConfig();
  };
  $('dealSpeed').onchange = (event) => {
    config.dealIntervalMs = Number(event.target.value);
    storeConfig();
  };
  $('speed').onchange = (event) => {
    config.speed = Number(event.target.value);
    storeConfig();
  };
  $('requestLimit').onchange = (event) => {
    config.limits.maxRequests = Number(event.target.value);
    storeConfig();
  };
  $('outputLimit').onchange = (event) => {
    config.limits.maxOutput = Number(event.target.value);
    storeConfig();
  };
  $('timeoutLimit').onchange = (event) => {
    config.limits.timeoutMs = decisionTimeoutMs(Number(event.target.value) * 1000);
    event.target.value = config.limits.timeoutMs / 1000;
    storeConfig();
  };
  $('apiPreset').onclick = () => {
    const profile = latest?.connections?.find(p => p.sponsored && p.default) || latest?.connections?.[0];
    config.seats = defaultSeats().map((seat, index) =>
      index
        ? { ...seat, kind: 'api', provider: profile?.provider || 'qwen', connectionId: profile?.id,
            model: profile?.sponsored ? profile.models[0].id : '', ...(profile?.sponsored ? { endgameAnalysis: false } : {}) }
        : seat,
    );
    storeConfig();
    renderSetup();
  };
  $('practicePreset').onclick = () => {
    config.seats = defaultSeats();
    storeConfig();
    renderSetup();
  };
  $('mixedPreset').onclick = () => {
    config.seats = defaultSeats();
    config.seats[1].kind = 'api';
    config.seats[3].kind = 'api';
    storeConfig();
    renderSetup();
  };
  $('watchPreset').onclick = () => {
    config.seats = defaultSeats().map((seat, index) => ({
      ...seat,
      kind: 'peilian',
      name: directions[index] + t('家'),
    }));
    storeConfig();
    renderSetup();
  };
  $('startGame').onclick = () => startMatch();
  if ($('restoreLocal'))
    $('restoreLocal').onclick = async () => {
      try {
        await post('restore-local', {});
        await refreshState();
        renderSetup();
        showScreen('menu');
      } catch (error) {
        notify(error.message);
      }
    };
  renderMenu();
}
function storeConfig() {
  try {
    localStorage.setItem('eighty-config', JSON.stringify(config));
  } catch {
    notify(t('浏览器未能保存设置，本次仍可使用。'));
  }
}

function showScreen(mode) {
  handDrag?.cancel();
  viewMode = mode;
  $('mainMenu').hidden = mode !== 'menu';
  $('settingsView').hidden = mode !== 'settings';
  $('newGameView').hidden = mode !== 'setup';
  $('gameView').hidden = mode !== 'game';
  document.body.dataset.screen = mode;
  try {
    sessionStorage.setItem('eighty-screen', mode === 'game' ? 'game' : 'menu');
  } catch {}
  render();
  presence();
}
function applyAppearance(save = false) {
  const body = document.body;
  for (const key of ['fourColor', 'texture', 'hints']) body.dataset[key] = appearance[key] ? 'on' : 'off';
  body.dataset.motion = appearance.motion && !motionPreference.matches && !document.hidden ? 'on' : 'off';
  body.dataset.effects = appearance.effects;
  body.dataset.paused = latest?.paused && viewMode === 'game' ? 'true' : 'false';
  $('effectQuality').value = appearance.effects;
  atmosphere.update({
    effects: appearance.effects,
    motion: body.dataset.motion === 'on',
    screen: viewMode,
    paused: latest?.paused && viewMode === 'game',
  });
  for (const [id, key] of Object.entries({
    fourColor: 'fourColor',
    cardMotion: 'motion',
    trainingToggle: 'learning',
    tableTexture: 'texture',
    showHints: 'hints',
    dragToPlay: 'dragToPlay',
    tableSound: 'sound',
    tableMusic: 'music',
  }))
    $(id).checked = appearance[key];
  for (const id of ['handSize', 'tableSize', 'textSize']) {
    $(id).value = String(appearance[id]);
    body.style.setProperty('--' + id.replace('Size', '-scale'), appearance[id]);
  }
  $('soundVolume').value = appearance.volume;
  $('soundVolume').disabled = !appearance.sound;
  $('musicVolume').value = appearance.musicVolume;
  $('musicVolume').disabled = !appearance.music;
  $('soundPreview').disabled = !appearance.sound || !appearance.volume;
  const audioOn = appearance.sound && appearance.volume > 0 || appearance.music && appearance.musicVolume > 0;
  $('audioToggle').textContent = audioOn ? pick('♪ 静音', '♪ Mute audio') : pick('♪ 开启声音', '♪ Enable audio');
  $('audioToggle').setAttribute('aria-pressed', String(!!audioOn));
  sound.sync(); music.update({ muffled: viewMode !== 'game' || !!latest?.paused || !!latest?.game?.score });
  musicStatus(music.state());
  if (save)
    try {
      localStorage.setItem('eighty-pixel-options', JSON.stringify(appearance));
    } catch {}
  handHover?.refresh();
}
function renderMenu() {
  const game = latest?.game;
  $('menuStart').disabled = !connected || !csrfToken || starting;
  text('menuStart', '新游戏', 'New game');
  $('continueGame').hidden = !game;
  text('continueGame', game?.score ? '查看本局结果' : '继续游戏', game?.score ? 'View round result' : 'Continue');
  $('menuSummary').textContent = setupSeatRows(config.seats)
    .map(
      ({ index, label, hint }) =>
        (config.seats.some((seat) => seat.kind === 'human') ? label : label + ' · ' + hint) +
        ' · ' +
        typeName(config.seats[index]),
    )
    .join('  /  ');
  $('resumeSummary').textContent = game
    ? pick('已保留当前对局，可继续或另开一桌。', 'Your current game is saved. Continue it or start a new table.')
    : pick('点击新游戏，安排四个座位，一起上桌。', 'Choose New game, arrange four seats, and take your place.');
  $('connectionLabel').textContent = connected
    ? (latest?.siteEdition ? pick('● 牌桌已连接', '● Table connected') : pick('● 本地牌桌已连接', '● Local table connected'))
    : pick('○ 正在连接牌桌…', '○ Connecting to the table…');
}
async function startMatch(confirmed = false) {
  if (starting || !connected) return;
  if (latest?.game && !confirmed) {
    $('restartDialog').showModal();
    return;
  }
  if (
    config.seats.some(
      (seat) =>
        seat.kind === 'api' &&
        seat.provider !== 'mock' &&
        (!connectionFor(seat, latest?.connections || []) || !seat.model),
    )
  ) {
    notify(
      pick(
        '请先为 API 座位连接服务并选择模型，或选择陪练。',
        'Connect a service and choose a model for each API seat, or choose a practice bot.',
      ),
    );
    return;
  }
  starting = true;
  renderMenu();
  try {
    await post('start', config);
    viewer = config.seats.findIndex((seat) => seat.kind === 'human');
    selected.clear();
    quiz = null;
    quizKey = null;
    await refreshState();
    connect();
    $('restartDialog').close();
    showScreen('game');
  } catch (error) {
    notify(error.message);
  } finally {
    starting = false;
    renderSetup();
    renderMenu();
  }
}
async function resumeGame() {
  try {
    if (latest?.paused) await post('pause', { paused: false });
    $('pauseDialog').close();
    await refreshState();
    showScreen('game');
  } catch (error) {
    notify(error.message);
  }
}
async function mainMenu() {
  if (latest?.game && !latest.paused && connected)
    try {
      await post('pause', { paused: true });
    } catch (error) {
      notify(error.message);
    }
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  showScreen('menu');
  $('continueGame').focus();
}
async function pauseGame() {
  handDrag?.cancel();
  if (connected)
    try {
      if (latest?.game && !latest.paused) await post('pause', { paused: true });
      await refreshState();
    } catch (error) {
      notify(error.message);
    }
  $('pauseReason').textContent = connected
    ? pick('返回主菜单可以调整下一场的设置。', 'Return to the main menu to configure your next game.')
    : pick('连接暂时中断，正在重连。', 'The connection is interrupted. Reconnecting.');
  $('pauseDialog').showModal();
}
function presence() {
  if (!csrfToken) return;
  if(latest?.capabilities?.webSocket){
    const visible=viewMode==='game'&&!document.hidden;
    if(stream?.readyState===1&&socketPresence!==visible){stream.send(JSON.stringify({type:'presence',visible}));socketPresence=visible;}
    return;
  }
  fetch('/api/presence', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-eighty-csrf': csrfToken },
    body: JSON.stringify({ clientId, visible: viewMode === 'game' && !document.hidden }),
    keepalive: true,
  }).catch(() => {});
}
function receive(next, request = null) {
  if (!acceptSnapshot(latest, next, viewer, request)) return;
  const oldProfiles = JSON.stringify(latest?.connections || []);
  csrfToken = next.csrf || '';
  const added = arrivingCard(latest?.game, next.game);
  if (added) arriving = { id: added.id, at: Date.now() };
  if (
    latest?.game &&
    next.game &&
    latest.game.id === next.game.id &&
    ['dealing', 'closing'].includes(latest.game.phase) &&
    !['dealing', 'closing'].includes(next.game.phase)
  ) {
    recalled = new Map(
      displayedDeclarations(latest.game)
        .find((row) => row.seat === viewer)
        ?.cards.map((card) => [card.id, Date.now()]) || [],
    );
  }
  latest = next;
  if (
    JSON.stringify(status) !== JSON.stringify(latest.providers) ||
    oldProfiles !== JSON.stringify(latest.connections || [])
  ) {
    status = latest.providers;
    renderSetup();
  }
  const key = [latest.game?.id, latest.game?.attempts, viewer, latest.game?.pending?.id].join(':');
  if (lastDecision !== key) {
    handDrag?.cancel();
    selected.clear();
    anchor = null;
    lastDecision = key;
  }
  selected = new Set([...selected].filter((id) => latest.game?.hand.some((card) => card.id === id)));
  render();
}
async function refreshState() {
  const request = { viewer, csrf: csrfToken };
  const next = await fetch('/api/state?seat=' + request.viewer).then((response) => response.json());
  if (!next.csrf) throw new Error(t('本地服务暂不可用'));
  receive(next, request);
  return next;
}
function connect() {
  clearTimeout(reconnectTimer);reconnecting=false;
  clearInterval(socketHeartbeat);socketHeartbeat=null;socketPresence=null;
  stream?.close();
  connected = false;
  const useSocket=latest?.capabilities?.webSocket===true;
  const visible=viewMode==='game'&&!document.hidden;
  const path='/api/events?seat='+viewer+'&client='+clientId+'&visible='+visible;
  const connection=useSocket?new WebSocket(location.origin.replace(/^http/,'ws')+path):new EventSource(path);
  stream = connection;
  if(useSocket){
    socketPresence=visible;
    connection.onopen=()=>{
      if(stream!==connection)return;
      socketHeartbeat=setInterval(()=>{if(stream===connection&&connection.readyState===1)connection.send('{"type":"ping"}');},25000);
    };
    connection.onclose=()=>{if(stream===connection){clearInterval(socketHeartbeat);connection.onerror();}};
  }
  connection.onmessage = (event) => {
    if (stream !== connection || connection.readyState>1) return;
    const data=JSON.parse(event.data);
    if(data.type==='pong')return;
    clearTimeout(reconnectTimer);reconnecting=false;
    const reconnect = !connected;
    connected = true;
    receive(data);
    if (reconnect) presence();
  };
  connection.onerror = () => {
    if (stream !== connection) return;
    connected = false;
    render();
    if (!reconnecting) {
      reconnecting = true;
      clearInterval(socketHeartbeat);connection.close();
      let delay=1500;
      const retry=async()=>{
        if(stream!==connection)return;
        try{await refreshState();if(stream===connection)connect();}
        catch{if(stream===connection){delay=Math.min(30000,delay*2);reconnectTimer=setTimeout(retry,delay);}}
      };
      reconnectTimer=setTimeout(retry,delay);
    }
  };
}
function canPlay() {
  const game = latest?.game;
  return (
    viewMode === 'game' &&
    connected &&
    !submitting &&
    !latest?.paused &&
    !latest?.autoplay.includes(viewer) &&
    isHumanTurn(game, viewer) &&
    ['lead', 'follow', 'bury'].includes(game.pending.phase) &&
    !document.querySelector('dialog[open]')
  );
}
function handCard(card, enabled, game) {
  const trump = game.trump && (card.suit === 'X' || card.rank === game.trump.rank || card.suit === game.trump.suit);
  const tab = card.id === focusCard || (!game.hand.some((c) => c.id === focusCard) && card.id === game.hand[0]?.id);
  return `<button class="hand-slot" data-live-style data-trump="${!!trump}" data-recalled="${Date.now() - (recalled.get(card.id) || 0) < 450}" data-arriving="${arriving?.id === card.id && Date.now() - arriving.at < 350}" data-card="${card.id}" tabindex="${tab ? '0' : '-1'}" aria-label="${escape(cardLabel(card)) + pick(' 第' + (card.id >= 54 ? '二' : '一') + '张', ' · copy ' + (card.id >= 54 ? 2 : 1)) + (trump ? pick('，主牌', ', trump') : '')}" aria-pressed="${selected.has(card.id)}"${enabled ? '' : ' disabled'}><span class="reflow" data-preserve><span class="lift" data-preserve><span class="face" data-suit="${card.suit}" aria-hidden="true">${cardFace(card)}</span></span></span></button>`;
}
function handPanel(game) {
  const touch = innerWidth < 760 || matchMedia('(pointer: coarse)').matches;
  const decision = game.pending,
    bidding = game.dealing === 'continuous' && ['dealing', 'closing'].includes(game.phase);
  const handoff =
    game.seats.filter((seat) => seat.kind === 'human').length > 1 &&
    decision &&
    game.seats[decision.seat].kind === 'human' &&
    viewer !== decision.seat;
  if (handoff)
    return `<div class="hand-panel curtain"><h3>${pick('请把屏幕交给 ', 'Pass the screen to ') + escape(playerName(game, decision.seat))}</h3><p>${pick('准备好后再查看自己的手牌。', 'Reveal your own hand when you are ready.')}</p><button class="primary" id="handoff">${t('查看我的手牌')}</button></div>`;
  const mine =
    connected && !submitting && isHumanTurn(game, viewer) && !latest.paused && !latest.autoplay.includes(viewer);
  const playing = mine && ['lead', 'follow', 'bury'].includes(decision.phase);
  let prompt = '',
    help = '',
    bids = '',
    actions = '';
  if (bidding) {
    prompt = latest.paused
      ? pick('牌局已暂停', 'Game paused')
      : game.phase === 'closing'
        ? pick('最后反主时间', 'Last chance to counterdeclare')
        : pick('正在发牌', 'Dealing') + ' · ' + game.dealt + '/100';
    if (!latest.paused && viewer >= 0 && !latest.autoplay.includes(viewer))
      bids = game.bidOptions.map((item) => bidButton(item, game)).join('');
    help = pick('25 张手牌 · 庄家随后拿起 8 张底牌', '25 cards each · the dealer then picks up the eight-card kitty');
  } else if (mine && decision.phase === 'declare') {
    prompt =
      (game.phase === 'closing' ? pick('最后亮主机会', 'Last declaration') : pick('轮到你亮主', 'Your declaration')) +
      ' · ' +
      game.dealt +
      '/100';
    bids =
      `<button class="secondary" data-bid="pass">${t('本次不亮')}</button>` +
      decision.options.map((item) => bidButton(item, game)).join('');
  } else if (mine && decision.phase === 'rebel') {
    prompt = pick('是否重新发牌？', 'Request a redeal?');
    bids = `<button class="primary" id="acceptRebel">${t('重新发牌')}</button><button class="secondary" id="declineRebel">${t('继续打')}</button>`;
  } else if (playing) {
    const error = selectionError(game, [...selected]),
      collecting = !!tableMotion && game.phase === 'play';
    prompt = collecting
      ? pick('收牌中 · 可以先选牌', 'Collecting · you can preselect')
      : decision.phase === 'bury'
        ? pick('你是庄家 · 扣下 8 张底牌', 'You are dealer · bury 8 cards')
        : decision.phase === 'lead'
          ? pick('轮到你领出', 'Your lead')
          : pick('跟出 ', 'Follow with ') + cardCount(game.plays[0].cards.length);
    const ready =
      decision.phase === 'bury'
        ? pick('选好了，确认扣底', 'Ready to bury')
        : touch
          ? appearance.dragToPlay
            ? pick('按出牌确认，也可向上拖出', 'Press Play or drag upward')
            : pick('按出牌确认', 'Press Play to confirm')
        : appearance.dragToPlay
          ? pick('拖动任一已选牌一起出 · 也可按出牌', 'Drag any selected card to play the group · or press Play')
          : pick('准备好了，确认出牌', 'Ready to confirm');
    help = selected.size
      ? pick('已选 ', 'Selected ') + selected.size + ' · ' + (error || ready)
      : decision.phase === 'bury'
        ? pick('选满 8 张，再确认扣底', 'Select eight cards, then confirm')
        : touch
          ? pick('左右滑动看牌 · 点选后按出牌', 'Swipe to browse · tap cards, then Play')
        : appearance.dragToPlay
          ? pick('点选悬起 · 拖动已选牌可整组出牌', 'Click to select · drag a selected card to play the group')
          : pick('点选或拖出选牌 · 按出牌确认', 'Click or drag to select · confirm to play');
    actions = `<button class="quiet" id="suggest">${pick('帮选', 'Help select')}</button><button class="quiet" id="clearSelection"${selected.size ? '' : ' disabled'}>${pick('清空', 'Clear')}</button><button class="primary" id="playCards"${error || collecting ? ' disabled' : ''}>${decision.phase === 'bury' ? pick('确认扣底', 'Bury cards') : pick('出牌', 'Play')} ↵</button>`;
  } else {
    prompt = latest.paused
      ? pick('牌局已暂停', 'Game paused')
      : game.score
        ? pick('本局结束', 'Deal complete')
        : decision
          ? pick('等待 ', 'Waiting for ') + escape(seatLabel(game, decision.seat))
          : pick('等待牌局', 'Waiting for the table');
    help = latest.autoplay.includes(viewer)
      ? pick(
          '陪练正在替你打牌，可在暂停菜单收回托管。',
          'A practice bot is playing your hand. Take back control from the pause menu.',
        )
      : touch ? pick('左右滑动查看手牌', 'Swipe sideways to browse your hand') : '';
  }
  const shown = new Set(
      displayedDeclarations(game)
        .find((row) => row.seat === viewer)
        ?.cards.map((card) => card.id) || [],
    ),
    visibleHand = game.hand.filter((card) => !shown.has(card.id));
  const staged = game.hand.filter((card) => selected.has(card.id));
  const draft =
    playing && !tableMotion && decision.phase === 'bury'
      ? `<div class="burial-guide" data-live-style><div class="burial-progress" aria-hidden="true">${Array.from({ length: 8 }, (_, index) => `<i${index < selected.size ? ' class="filled"' : ''}></i>`).join('')}</div><strong>${pick('已选 ', 'Selected ')}${selected.size} / 8 · ${pick('底牌分数 ', 'Kitty points ')}${points(staged)}</strong><p>${pick('留好控牌，选择八张扣下。若对手赢最后一墩，底牌分会翻倍计入攻分。', 'Keep control and choose eight cards to bury. If opponents win the last trick, kitty points are multiplied into their score.')}</p></div>`
      : '';
  const status = `<div class="turn-message" id="roundProgress"><span class="status-title"><strong>${prompt}</strong>${bidding && game.phase === 'closing' ? closingClock(latest.dealClock) : ''}</span><small title="${escape(help)}">${appearance.hints ? help : ''}</small>${playing && appearance.hints ? `<span class="hand-help">${pick('← → 移动 · 空格选牌 · Enter 确认', '← → move · Space select · Enter confirm')}</span>` : ''}${latest.paused && !game.score ? `<button class="primary" id="resumeInline">${pick('继续游戏', 'Resume')}</button>` : ''}</div>`;
  if (game.viewer < 0) return `<div class="spectator-status">${status}</div>`;
  return (
    draft +
    `<div class="drop-target" id="dropTarget" data-live-style aria-hidden="true">${pick('拖到这里出牌', 'Drop here to play')}</div>` +
    `<div class="hand-panel" id="handPanel"><div class="hand" id="playerHand" data-live-style role="group" aria-label="${pick('你的手牌', 'Your hand')}"><div class="hand-content" id="handContent" data-live-style>${visibleHand.length ? visibleHand.map((card) => handCard(card, playing, game)).join('') : `<div class="empty-hand">${viewer < 0 ? pick('公开观战视角', 'Public spectator view') : game.score ? '' : pick('手牌将在发牌时到来', 'Your cards arrive as the deal begins')}</div>`}</div></div><div class="hand-footer"><span class="hand-info${game.dealer === viewer ? ' is-dealer' : ''}">${game.dealer === viewer ? `<b class="dealer-inline" aria-label="${pick('庄家', 'Dealer')}">${pick('庄', 'D')}</b>` : ''}${viewer < 0 ? pick('观战', 'Watching') : pick('手牌 ', 'Hand · ') + cardCount(game.hand.length)}<small>${viewer < 0 ? '' : pick('你 · ', 'You · ') + directions[viewer] + (game.dealer === viewer ? pick(' · 庄家', ' · dealer') : '')}</small></span>${status}<div class="hand-actions">${actions}</div>${bids || bidding ? `<div class="bidding-footer"><div class="bid-options">${bids}</div></div>` : ''}</div></div>`
  );
}
function bidButton(item, game) {
  const rank = (game.dealerKnown ?? game.dealer >= 0) ? game.trumpRank : game.match.levels[viewer % 2];
  return `<button class="secondary" data-bid="${item.id}"${!connected || submitting ? ' disabled' : ''}>${item.suit ? SYMBOLS[item.suit] + ' ' + rankLabel(rank) + (item.strength === 2 ? t(' 一对') : t(' 单张')) : item.strength === 4 ? t('大王对 · 无主') : t('小王对 · 无主')}</button>`;
}
let fittingTable = false;
function layoutHand() {
  const board = $('cardTable'),
    frame = $('gameArea');
  if (fittingTable || handDrag?.active || !board || !frame || viewMode !== 'game') return;
  const padding = getComputedStyle(document.body);
  $('gameView').style.height =
    Math.max(1, innerHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom)) + 'px';
  if (!frame.clientWidth || !frame.clientHeight) return;
  fittingTable = true;
  try {
    const width = frame.clientWidth,
      height = frame.clientHeight;
    const mobile = width < 760 || width < 1050 && (height < 540 || matchMedia('(pointer: coarse)').matches);
    board.dataset.layout = mobile ? height < 540 && width > height ? 'compact' : 'phone' : 'desktop';
    board.dataset.density = height < 620 ? 'tiny' : height < 740 ? 'short' : 'normal';
    if (mobile) {
      board.style.width = width + 'px';
      board.style.left = '0px';board.style.top = '0px';board.style.transform = 'none';board.dataset.sceneScale = '1';
      layoutHandCards();layoutTable(height);handHover?.refresh();
      return;
    }
    const minimumWidth = Math.max(1280, handLayout(33, 1280, appearance.handSize).contentWidth + 44);
    let scale = initialSceneScale(width, height, minimumWidth);
    for (let pass = 0; pass < 5; pass++) {
      board.style.width = width / scale + 'px';
      board.style.left = '0px';
      board.style.top = '0px';
      board.style.transform = `scale(${scale})`;
      board.dataset.sceneScale = String(scale);
      layoutHandCards();
      const layout = layoutTable(height / scale);
      if (!layout) break;
      const fit = fitScene(width, height, board.offsetWidth, layout.height);
      if (fit.scale >= scale - 0.0005 || pass === 4) {
        board.style.transform = `scale(${fit.scale})`;
        board.dataset.sceneScale = String(fit.scale);
        board.style.left = fit.left + 'px';
        board.style.top = fit.top + 'px';
        break;
      }
      scale = fit.scale;
    }
    // A final pass updates animation targets in the fitted coordinate space.
    layoutTable(height / Number(board.dataset.sceneScale));
    handHover?.refresh();
  } finally {
    fittingTable = false;
  }
}
function layoutHandCards() {
  const root = $('playerHand'),
    content = $('handContent');
  if (!root || !content || !root.clientWidth || handDrag?.active) return;
  const nodes = [...content.querySelectorAll('.hand-slot')],
    mode = $('cardTable').dataset.layout,
    density = $('cardTable').dataset.density,
    handScale = appearance.handSize * (mode === 'phone' ? density === 'tiny' ? .75 : density === 'short' ? 11/12 : 1 : 1),
    layout = handLayout(nodes.length, root.clientWidth, handScale, mode !== 'desktop', mode === 'compact');
  content.style.width = layout.contentWidth + 'px';
  $('cardTable').style.setProperty('--hand-h', layout.cardHeight + 'px');
  root.style.setProperty('--card-w', layout.cardWidth + 'px');
  root.style.setProperty('--card-h', layout.cardHeight + 'px');
  root.dataset.rows = '1';
  nodes.forEach((node, index) => {
    const p = layout.positions[index];
    node.style.left = p.left + 'px';
    node.style.bottom = '0px';
    node.style.width = p.width + 'px';
    node.style.height = layout.cardHeight + 'px';
    node.style.setProperty('--bob-delay', index * -0.17 + 's');
  });
}
function layoutTable(sceneHeight) {
  const board = $('cardTable'),
    probe = $('tableCardSize');
  if (!board || !probe?.offsetWidth) return;
  const mobile = board.dataset.layout !== 'desktop', compact = board.dataset.layout === 'compact';
  const north = board.querySelector('.seat.north');
  const sides = [...board.querySelectorAll('.seat.west,.seat.east')],
    panel = board.querySelector('.hand-panel');
  const spectatorSeat = latest?.game?.viewer < 0 ? board.querySelector('.seat.south') : null;
  const gap = 18,
    sideHeight = Math.max(0, ...sides.map((node) => node.offsetHeight));
  const hudBottom = Math.max(
    ...[...board.querySelectorAll('.trump-marker,.score-ticket')].map((node) => node.offsetTop + node.offsetHeight),
  );
  const cardWidth = probe.offsetWidth,
    captionHeight = $('tableCaptionSize').offsetHeight;
  const layout = tableLayout({
    width: board.clientWidth,
    height: mobile ? sceneHeight : Math.max(850, sceneHeight),
    northBottom: north.offsetTop + north.offsetHeight,
    sideEdge: Math.max(
      ...sides.map((node) =>
        node.classList.contains('west') ? node.offsetLeft + node.offsetWidth : board.clientWidth - node.offsetLeft,
      ),
    ),
    sideHeight,
    hudBottom,
    handHeight: spectatorSeat?.offsetHeight || panel?.offsetHeight || 0,
    handBottom: parseFloat(getComputedStyle(spectatorSeat || panel).bottom) || 0,
    cardWidth,
    captionHeight,
    narrow: mobile,
    compact,
    dense: mobile && board.dataset.density !== 'normal',
  });
  board.style.height = layout.height + 'px';
  board.style.minHeight = layout.minimumHeight + 'px';
  if (spectatorSeat)
    board.style.setProperty(
      '--spectator-note-width',
      Math.max(70, board.clientWidth / 2 - spectatorSeat.offsetWidth / 2 - 22 - gap) + 'px',
    );
  for (const [key, value] of Object.entries({
    'north-y': layout.northTop,
    'side-y': layout.sideTop,
    'south-y': layout.southTop,
    'west-x': layout.west,
    'east-x': layout.east,
    'side-seat-y': layout.sideSeatTop,
    'hand-top': layout.handTop,
    'fan-max': layout.maxFanWidth,
  }))
    board.style.setProperty('--' + key, value + 'px');
  for (const node of board.querySelectorAll('.played-slot')) {
    const count = node.querySelectorAll('.flip-card').length,
      badge = node.querySelector('.fan-overflow');
    node.style.setProperty(
      '--fan-overlap',
      fanOverlap(cardWidth, count, layout.maxFanWidth - (badge ? badge.offsetWidth + 4 : 0), 0.25) + 'px',
    );
  }
  const center = board.querySelector('.deck-center'),
    burial = board.querySelector('.burial-guide');
  for (const node of [center, burial])
    if (node) {
      const reserving = node === center && ['dealing','closing'].includes(latest.game.phase);
      const reserve = mobile ? compact ? 0 : 96 : 170;
      const northDeclared = reserving ? reserve : board.querySelector('.declaration-pile.north')?.offsetHeight || 0,
        southDeclared = reserving ? reserve : board.querySelector('.declaration-pile.south')?.offsetHeight || 0;
      const top = layout.northTop + northDeclared,
        bottom = layout.handTop - southDeclared - gap;
      node.style.top = Math.max(top, (top + bottom - node.offsetHeight) / 2) + 'px';
      node.style.transform = 'translateX(-50%)';
    }
  const drop = $('dropTarget');
  if (drop) {
    const header=board.querySelector('.game-top');
    const top=header.offsetTop+header.offsetHeight+12;
    drop.style.left='12px';drop.style.right='12px';
    drop.style.top = top + 'px';
    drop.style.bottom = 'auto';
    drop.style.height = Math.max(0,layout.handTop+8-top) + 'px';
  }
  for (const node of board.querySelectorAll('.declaration-pile.south')) {
    node.style.top = layout.handTop - node.offsetHeight - gap + 'px';
    node.style.bottom = 'auto';
  }
  const boardRect = board.getBoundingClientRect(),
    scale = Number(board.dataset.sceneScale) || 1;
  for (const node of board.querySelectorAll('.played-slot[data-winner]')) {
    const fan = node.querySelector('.played-fan'),
      target =
        node.dataset.winner === 'south' && $('playerHand')?.clientWidth
          ? $('playerHand')
          : board.querySelector('.seat.' + node.dataset.winner + ' .backs');
    if (!target) continue;
    const to = target.getBoundingClientRect(),
      from = node.getBoundingClientRect();
    // The fan animates; its layout offsets remain the stable starting point.
    node.style.setProperty('--collect-x', (to.left + to.width / 2 - from.left) / scale - node.clientWidth / 2 + 'px');
    node.style.setProperty(
      '--collect-y',
      (to.top + to.height / 2 - boardRect.top) / scale - node.offsetTop - fan.offsetHeight / 2 + 'px',
    );
  }
  return layout;
}
function bindHand() {
  const root = $('playerHand');
  if (root !== handHoverRoot) {
    handDrag?.destroy();
    handHover?.destroy();
    handResize?.disconnect();
    handDrag = null;
    handHover = null;
    handHoverRoot = root;
    if (root) {
      handHover = createHandHover(root, {
        items: () => [...root.querySelectorAll('.hand-slot')],
        visual: (node) => node.querySelector('.lift'),
        identity: (node) => Number(node.dataset.card),
        lift: () => $('cardTable')?.dataset.layout === 'desktop' ? 34 : 16,
        selectedLift: () => $('cardTable')?.dataset.layout === 'desktop' ? 48 : $('cardTable')?.dataset.layout === 'compact' || $('cardTable')?.dataset.density === 'tiny' ? 22 : 30,
        spread: true,
        reducedMotion: () => !appearance.motion,
        clipToRoot: true,
        blocked: () => !!handDrag?.active || !!document.querySelector('dialog[open]'),
      });
      handDrag = createHandDrag(root, {
        hover: handHover,
        allowed: canPlay,
        toggle: toggleSelection,
        cards: (id) => dragCardIds(latest.game.hand, selected, id),
        preview: dropFeedback,
        drop: dropCards,
        reducedMotion: () => !appearance.motion || motionPreference.matches,
        changed: layoutHand,
      });
      handResize = new ResizeObserver(layoutHand);
      handResize.observe(root);
      if (new URLSearchParams(location.search).has('qa')) window.__handHover = handHover;
    }
  }
  layoutHand();
  handDrag?.refresh();
  // Pointer capture retargets the native double click to the hand container.
  // Pair selection must use the same visible-card picker as individual clicks.
  if(root)root.ondblclick=event=>{
    if(!canPlay()||handDrag?.active)return;
    const target=event.target.closest?.('.hand-slot');
    const id=event.detail===0?(target?Number(target.dataset.card):null):handHover?.pick(event.clientX,event.clientY)?.id;
    if(id!=null)setSelection(selectPair(latest.game.hand,selected,Number(id)));
  };
  document.querySelectorAll('.hand-slot').forEach((button) => {
    button.onclick = (event) => {
      if (event.detail === 0 && canPlay() && !handDrag?.active)
        toggleSelection(Number(button.dataset.card), event.shiftKey);
    };
    button.onfocus = () => {
      focusCard = Number(button.dataset.card);
      document.querySelectorAll('.hand-slot').forEach((node) => (node.tabIndex = node === button ? 0 : -1));
    };
  });
}
function dropFeedback(ids) {
  const game = latest.game;
  const guide=pick('向桌面拖出 · 放回手牌取消', 'Lift onto the table · return to cancel');
  if (game.pending.phase === 'bury' || !appearance.dragToPlay) {
    const valid = game.pending.phase !== 'bury' || new Set([...selected, ...ids]).size <= 8;
    return {
      valid,
      selectOnly: true,
      guide,
      label: !valid
        ? pick('只需要 8 张底牌，请先收回一张。', 'Only eight kitty cards are needed. Unselect one first.')
        : game.pending.phase === 'bury'
          ? pick('松开选牌 · 按钮确认扣底', 'Release to select · use Bury to confirm')
          : pick('松开选牌 · 按出牌确认', 'Release to select · press Play to confirm'),
    };
  }
  const error =
    selectionError(game, ids) || (tableMotion ? pick('收牌后再出牌。', 'Wait for the trick to be collected.') : null);
  return {
    valid: !error,
    guide,
    label: error
      ? pick('放回手牌 · ', 'Return to hand · ') + error
      : pick('松开打出 ', 'Release to play ') + cardCount(ids.length),
  };
}
function dropCards(ids) {
  const feedback = dropFeedback(ids);
  if (!feedback.valid) {
    notify(feedback.label);
    return false;
  }
  if (feedback.selectOnly) {
    focusCard = ids[0];
    setSelection(new Set([...selected, ...ids]));
    return false;
  }
  const game = latest.game,
    actor = viewer,
    decision = game.pending.id,
    version = game.version;
  // Start after the drag controller has released capture; the envelope is still
  // validated by act() and the server. A changed turn cannot reuse this gesture.
  queueMicrotask(() => {
    if (
      canPlay() &&
      viewer === actor &&
      latest.game.id === game.id &&
      latest.game.version === version &&
      latest.game.pending.id === decision
    )
      act({ type: 'play', cardIds: ids });
  });
  return true;
}
function setSelection(next) {
  if (latest?.game?.pending?.phase === 'bury' && next.size > 8) {
    notify(pick('只需要 8 张底牌，请先收回一张。', 'Only eight kitty cards are needed. Unselect one first.'));
    return;
  }
  selected = next;
  sound();
  render();
}
function toggleSelection(id, shift = false) {
  focusCard = id;
  const next = shift ? selectRange(latest.game.hand, selected, anchor, id) : new Set(selected);
  if (!shift) {
    next.has(id) ? next.delete(id) : next.add(id);
    anchor = id;
  }
  setSelection(next);
}
function render() {
  renderMenu();
  applyAppearance();
  document.body.dataset.screen = viewMode;
  const game = latest?.game;
  const dealingActive = viewMode === 'game' && !latest?.paused && !document.hidden && appearance.motion && !motionPreference.matches && !document.querySelector('dialog[open]');
  const beforeHand = dealMotion.capture(game,dealingActive);
  clearTimeout(motionTimer);
  tableMotion = trickFlow.update(game, {
    now: performance.now(),
    paused: latest?.paused,
    reducedMotion: motionPreference.matches || !appearance.motion,
    hidden: document.hidden || viewMode !== 'game',
  });
  if (tableMotion) motionTimer = setTimeout(render, tableMotion.remaining + 1);
  if (!game && viewMode === 'game') {
    viewMode = 'menu';
    $('gameView').hidden = true;
    $('mainMenu').hidden = false;
    handDrag?.cancel();
  }
  if (!game || viewMode !== 'game') {
    dealMotion.update(game,{active:false});
    tableEffects.update(game, { active: false, motion: null });
    return;
  }
  const boardClass = game.viewer < 0 ? ' spectator' : '';
  const header = `<div class="game-top"><div><button class="pixel-button" id="pauseGame">☰ ${pick('菜单', 'Menu')}</button><span class="match-tag">${pick('第 ', 'Deal ')}${game.score ? game.match.round : game.match.round + 1}${pick(' 局', '')} · ${pick('南北', 'S/N')} ${levelLabel(game.match.levels[0])} / ${pick('东西', 'E/W')} ${levelLabel(game.match.levels[1])}</span></div><div class="game-tools"><button class="quiet" id="bookButton">▤ ${pick('记牌簿', 'Notebook')}</button><button class="quiet" id="lessonButton" aria-pressed="${appearance.learning}">${appearance.learning ? '✦' : '◇'} ${pick('边玩边学', 'Learn')}</button></div></div>`;
  patchHtml(
    $('gameArea'),
    `<div class="pixel-game${boardClass}" id="cardTable" data-live-style data-phase="${game.phase}"><div class="felt" aria-hidden="true"></div><div class="table-emblem" aria-hidden="true"><span>八 十 分</span><b>80</b><small>好牌 · 好搭档</small></div><div class="effects-layer" id="tableEffects" data-preserve aria-hidden="true"></div><span id="tableCardSize" class="table-card-size" aria-hidden="true"></span><span id="tableCaptionSize" class="play-caption table-caption-size" aria-hidden="true"></span>${header}${dealMarkers(game)}${game.seats.map((seat, index) => pixelSeat(game, index, typeName(seat), latest, tableMotion)).join('')}${deckMarkup(game)}${declarationMarkup(game)}${trickMarkup(game, tableMotion)}${!tableMotion ? resultMarkup(game) : ''}${handPanel(game)}</div>`,
  );

  const ownTurn = {
    bury: pick('轮到你扣底，请选八张牌。', 'Your burial. Choose eight cards.'),
    lead: pick('轮到你领出。', 'Your lead.'),
    follow: pick('轮到你跟牌。', 'Your turn to follow.'),
    declare: pick('可以亮主。', 'You may declare trump.'),
    rebel: pick('请选择是否重新发牌。', 'Choose whether to redeal.'),
  }[game.pending?.phase];
  $('turnAnnouncement').textContent = tableMotion
    ? seatLabel(game, tableMotion.trick.winner) +
      pick(' 收下本墩，', ' took this trick, ') +
      tableMotion.trick.points +
      pick(' 分。', ' points.')
    : isHumanTurn(game, viewer)
      ? ownTurn || ''
      : '';
  $('pauseGame').onclick = pauseGame;
  $('bookButton').onclick = () => {
    $('bookDialog').showModal();
    renderBook();
  };
  $('lessonButton').onclick = () => {
    $('lessonDialog').showModal();
    renderTraining(latest.game);
  };
  if ($('resumeInline')) $('resumeInline').onclick = resumeGame;
  if ($('nextDeal')) $('nextDeal').onclick = nextDeal;
  if ($('resultMenu')) $('resultMenu').onclick = mainMenu;
  if ($('handoff'))
    $('handoff').onclick = () => {
      viewer = game.pending.seat;
      selected.clear();
      quiz = null;
      quizKey = null;
      connect();
    };
  document
    .querySelectorAll('[data-bid]')
    .forEach(
      (button) => (button.onclick = () => act({ type: 'declare', choice: button.dataset.bid }, game.bidContext)),
    );
  if ($('acceptRebel')) $('acceptRebel').onclick = () => act({ type: 'rebel', accept: true });
  if ($('declineRebel')) $('declineRebel').onclick = () => act({ type: 'rebel', accept: false });
  if ($('playCards'))
    $('playCards').onclick = () =>
      act({ type: game.pending.phase === 'bury' ? 'bury' : 'play', cardIds: [...selected] });
  if ($('clearSelection'))
    $('clearSelection').onclick = () => {
      selected.clear();
      render();
    };
  if ($('suggest'))
    $('suggest').onclick = () => {
      const cards =
        game.pending.phase === 'bury'
          ? game.hand.slice(-8)
          : game.pending.phase === 'follow'
            ? safeFollow(game.hand, classify(game.plays[0].cards, game.trump), game.trump, game.rules)
            : [game.hand.at(-1)];
      selected = new Set(cards.map((card) => card.id));
      render();
    };
  document
    .querySelectorAll('[data-review-trick]')
    .forEach((button) => (button.onclick = () => reviewTrick(Number(button.dataset.reviewTrick))));
  bindHand();
  dealMotion.update(game,{active:dealingActive,before:beforeHand});
  updateClock();
  renderBook();
  renderTraining(game);
  for (const bar of document.querySelectorAll('[data-score-progress]'))
    bar.style.transform = `scaleX(${Number(bar.dataset.scoreProgress)})`;
  tableEffects.update(game, {
    active: !latest.paused && !document.hidden && !document.querySelector('dialog[open]'),
    motion: tableMotion,
  });
  $('autoplay').hidden = game.viewer < 0;
  $('autoplay').textContent = latest.autoplay.includes(viewer) ? t('收回托管') : t('托管');
}
function updateClock() {
  document.querySelectorAll('[data-closing-at]').forEach((node) => {
    const remaining = latest?.paused
      ? Number(node.dataset.closingRemaining)
      : Number(node.dataset.closingAt) - Date.now();
    node.textContent = remaining > 0 ? Math.ceil(remaining / 1000) + t(' 秒') : t('正在定主…');
  });
}
setInterval(updateClock, 200);
async function act(action, bidContext = null) {
  if (submitting || !connected || (action.type === 'play' && tableMotion)) return;
  const game = latest.game,
    actor = viewer,
    envelope = bidContext
      ? { seat: viewer, bidContext, action }
      : { decisionId: game.pending.id, version: game.version, seat: viewer, action };
  submitting = true;
  render();
  try {
    await post('action', envelope);
    if (viewer === actor && latest?.game?.id === game.id) {
      if (action.type === 'bury') sound('bury');
      selected.clear();
      await refreshState();
    }
  } catch (error) {
    notify(error.message);
  } finally {
    submitting = false;
    render();
  }
}
async function nextDeal() {
  try {
    quiz = null;
    quizKey = null;
    await post('next', {});
    await refreshState();
  } catch (error) {
    notify(error.message);
  }
}
function reviewTrick(index) {
  const game = latest.game,
    trick = game.tricks[index] || (index === game.tricks.length ? { index, plays: game.plays } : null);
  if (!trick?.plays.length) return;
  $('trickContent').innerHTML =
    `<span class="eyebrow">${pick('第 ', 'TRICK ')}${index + 1}${pick(' 墩', '')}</span><h2>${trick.winner === undefined ? pick('本墩进行中', 'Trick in progress') : escape(seatLabel(game, trick.winner)) + pick(' 收下 · ', ' wins · ') + trick.points}</h2>` +
    trick.plays
      .map(
        (play, order) =>
          `<div class="trick-review"><span>${escape(seatLabel(game, play.seat))}<small>${order === 0 ? t('领出') : t('跟牌')} · ${cardCount(play.cards.length)}</small></span><div>${play.cards.map(mini).join('')}</div></div>`,
      )
      .join('');
  $('trickDialog').showModal();
}
function renderBook() {
  if (!latest) return;
  const game = latest.game;
  renderNotebook(game, $('notebook'));
  renderStats();
  renderArchives();
  const labels = {
    declaration: t('亮主'),
    pass: t('不亮'),
    throw_failed: t('甩牌未成立，改出最小组件'),
    rebel_choice: t('重发选择'),
    trump_set: t('定主'),
    buried: t('扣底'),
    deal_started: t('新一局'),
  };
  const from = game?.events.findLast((event) => event.type === 'deal_started')?.seq ?? -1;
  const records =
    game?.events.filter((event) => event.seq >= from && (labels[event.type] || event.type === 'trick')) || [];
  patchHtml(
    $('history'),
    records.length
      ? records
          .slice(-80)
          .reverse()
          .map(
            (event) =>
              `<div class="history-row"><span class="number">${event.type === 'trick' ? String(event.index + 1).padStart(2, '0') : '·'}</span><span>${
                event.type === 'trick'
                  ? escape(playerName(game, event.winner)) +
                    pick(' 收下 · ', ' wins · ') +
                    (game.tricks[event.index]?.plays
                      .map((play) => playerName(game, play.seat) + ' ' + play.cards.map(cardLabel).join(' '))
                      .map(escape)
                      .join(' / ') || '')
                  : (event.seat !== undefined ? escape(seatName(game.seats[event.seat])) + ' · ' : '') +
                    labels[event.type] +
                    (event.type === 'declaration' ? ' · ' + (event.strength >= 2 ? pick('双张', 'Pair') : pick('单张', 'Single')) + ' ' + escape((event.cards || []).map(cardLabel).join(' ')) + (event.suit ? '' : ' · ' + t('无主')) : '')
              }</span>${event.type === 'trick' ? `<span class="points">+${event.points}</span>` : ''}</div>`,
          )
          .join('')
      : `<p class="fine">${pick('发牌后，这里会记录本局的公开事件。', 'Public events appear here as the deal begins.')}</p>`,
  );
  for (const tab of ['notebook', 'history', 'metrics']) $(tab).hidden = tab !== bookTab;
  document
    .querySelectorAll('[data-book-tab]')
    .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.bookTab === bookTab)));
}
function renderArchives() {
  const rows = latest?.archives || [];
  if (!rows.length) return;
  $('metrics').insertAdjacentHTML(
    'beforeend',
    `<details class="archives"><summary>${pick('此前对局用量', 'Previous game usage')}</summary>${rows
      .slice()
      .reverse()
      .map(
        (row) =>
          `<div class="archive-row">${escape(row.at.slice(0, 16).replace('T', ' '))} · ${row.requests} ${pick('次请求', 'requests')}<br>${row.input} / ${row.output} tokens · $${row.cost.toFixed(6)} · ${pick('未知用量', 'unknown usage')} ${row.unknown}</div>`,
      )
      .join('')}</details>`,
  );
}
function renderStats() {
  if (latest?.statsDeferred) {
    $('metrics').innerHTML =
      t(
        '<p class="fine">本局用量、耗时与代打记录将在结束后公开，避免泄露谁有机会叫主。后台仍完整记录每次调用。</p><p class="fine">本桌请求上限 ',
      ) +
      (latest.config?.limits.maxRequests ?? 100) +
      t(' 次 · 单次决策最多 12 秒</p>');
    return;
  }
  const stats = latest?.stats || {};
  $('metrics').innerHTML =
    '<div class="stat-grid">' +
    [
      [t('真实 API 请求'), stats.realRequests || 0, t('次')],
      [t('离线模拟决策'), stats.simulated || 0, t('次')],
      [
        t('已报告输入 / 输出'),
        (stats.input || 0).toLocaleString() + ' / ' + (stats.output || 0).toLocaleString(),
        'tokens',
      ],
      [t('API 请求平均耗时'), stats.latencyCount ? Math.round(stats.mean) : '—', 'ms'],
      [t('API 请求中位耗时'), stats.latencyCount ? Math.round(stats.p50) : '—', 'ms'],
      [t('API 请求 P95 耗时'), stats.latencyCount ? Math.round(stats.p95) : '—', 'ms'],
    ]
      .map(
        ([label, value, unit]) =>
          '<div class="stat"><small>' + label + '</small><strong>' + value + '</strong> <em>' + unit + '</em></div>',
      )
      .join('') +
    t('</div><div class="audit-status">最近 ') +
    (stats.latencyCount || 0) +
    t(' 次有耗时记录的 API 请求，含失败与超时<br>') +
    (latest?.game ? t('无需决策而跳过 ') + latest.game.forcedPasses + t(' 次亮主机会<br>') : '') +
    t('异常 ') +
    (stats.errors || 0) +
    t(' · 陪练代打 ') +
    (stats.fallbacks || 0) +
    t(' · 用量未知 ') +
    (stats.usageUnknown || 0) +
    t(' · 已报告缓存输入 ') +
    (stats.cached || 0) +
    t(' · 缓存未知 ') +
    (stats.cacheUnknown || 0) +
    t('<br>已报告推理 ') +
    (stats.reasoning || 0) +
    t(' tokens（已含在输出中）') +
    (stats.referencePricedRequests
      ? t('<br>标准价参考 $') +
        Number(stats.referenceCostUsd || 0).toFixed(6) +
        ' · ' +
        stats.referencePricedRequests +
        t(' 次已计价请求（非账单；包含套餐参考价或自填价，未含缓存优惠）')
      : t('<br>费用：暂无可计价的实际响应')) +
    '</div>' +
    (latest?.logs.findLast((entry) => entry.fallback)
      ? t('<p class="fine warning">最近一次陪练代打：') +
        escape(errorText(latest.logs.findLast((entry) => entry.fallback).reason)) +
        '</p>'
      : '') +
    (latest?.logs.at(-1)?.error
      ? '<p class="fine warning">' + escape(errorText(latest.logs.at(-1).error)) + '</p>'
      : '') +
    (latest?.game?.score ? t('<p class="fine"><a href="/api/audit" download>导出用量记录</a></p>') : '');
}
function renderTraining(game) {
  if (!$('trainingToggle').checked) return;
  if (
    game?.pending &&
    game.seats[game.pending.seat].kind === 'human' &&
    game.pending.seat !== viewer &&
    game.seats.filter((seat) => seat.kind === 'human').length > 1
  ) {
    quiz = null;
    quizKey = null;
    $('training').innerHTML = t('<p class="fine">完成手牌交接后，再显示当前玩家的练习。</p>');
    return;
  }
  if (!game?.tricks.length || viewer < 0 || game.viewer !== viewer) {
    $('training').innerHTML = t('<p class="fine">至少完成一墩后，练习会出现在这里。观战视角不进行私有信息练习。</p>');
    return;
  }
  const key = game.id + ':' + game.match.round + ':' + game.tricks.length + ':' + viewer;
  if (!quiz || (quizAnswered && quizKey !== key)) {
    quiz = trainingQuestion(game, locale);
    quizKey = key;
    quizAnswered = false;
    quizSelection.clear();
  }
  if (!quiz) {
    $('training').innerHTML =
      '<p class="fine">' +
      pick(
        '暂时没有合适的新题，完成下一墩再看看。',
        'No suitable new exercise yet. Check again after the next trick.',
      ) +
      '</p>';
    return;
  }
  patchHtml(
    $('training'),
    '<span class="quiz-title">' +
      escape(quiz.title) +
      '</span><p class="quiz-question">' +
      escape(quiz.question) +
      (quiz.multiple ? t('（可多选）') : '') +
      '</p><div class="quiz-options">' +
      quiz.options
        .map(
          (answer, index) =>
            '<button class="quiz-choice' +
            (quizSelection.has(answer) ? ' selected' : '') +
            '" data-answer="' +
            index +
            '"' +
            (quizAnswered ? ' disabled' : '') +
            '>' +
            escape(answer) +
            '</button>',
        )
        .join('') +
      '</div>' +
      (quizAnswered
        ? '<p class="quiz-answer">' +
          (JSON.stringify([...quizSelection].sort()) === JSON.stringify([...quiz.correct].sort())
            ? t('答对了。')
            : t('答案：') + quiz.correct.map(escape).join(pick('、', ', ')) + pick('。', '. ')) +
          escape(quiz.explanation) +
          '</p>'
        : t(
            '<div class="hand-actions"><button class="secondary" id="answerQuiz">检查答案</button><button class="quiet" id="skipQuiz">看解析</button></div>',
          )),
  );
  document.querySelectorAll('[data-answer]').forEach(
    (button) =>
      (button.onclick = () => {
        const answer = quiz.options[Number(button.dataset.answer)];
        if (!quiz.multiple) quizSelection.clear();
        if (quizSelection.has(answer)) quizSelection.delete(answer);
        else quizSelection.add(answer);
        renderTraining(game);
      }),
  );
  if ($('answerQuiz'))
    $('answerQuiz').onclick = () => {
      quizAnswered = true;
      renderTraining(game);
    };
  if ($('skipQuiz'))
    $('skipQuiz').onclick = () => {
      quizAnswered = true;
      quizSelection.clear();
      renderTraining(game);
    };
}

function labels() {
  for (const id of ['handSize', 'tableSize', 'textSize'])
    [...$(id).options].forEach(
      (node, index) =>
        (node.textContent =
          id === 'textSize'
            ? pick(['标准', '大', '更大'][index], ['Standard', 'Large', 'Extra large'][index])
            : pick(['紧凑', '标准', '大'][index], ['Compact', 'Standard', 'Large'][index])),
    );
  for (const [id, values] of Object.entries(UI_LABELS)) text(id, ...values);
  [...$('effectQuality').options].forEach(
    (node, index) => (node.textContent = pick(['华丽', '柔和', '关闭'][index], ['Full', 'Soft', 'Off'][index])),
  );
  $('menuTitle').innerHTML = '<span class="sr-only">' + pick('八十分', 'EIGHTY') + '</span>' + wordmark(locale);
  for (const [id, zh, en] of [
    ['mainMenu', '主菜单', 'Main menu'],
    ['settingsView', '通用设置', 'General settings'],
    ['newGameView', '新游戏', 'New game'],
    ['gameView', '牌桌', 'Game table'],
  ])
    $(id).setAttribute('aria-label', pick(zh, en));
  document.querySelector('#mainMenu nav').setAttribute('aria-label', pick('游戏菜单', 'Game menu'));
  for (const [id, zh, en] of [
    ['closeBook', '合上记牌簿', 'Close notebook'],
    ['closeLesson', '关闭练习', 'Close lesson'],
    ['closeCredits', '关闭鸣谢', 'Close credits'],
  ])
    $(id).setAttribute('aria-label', pick(zh, en));
  text('galleryButton', '查看整副牌面', 'Card gallery');
  text('galleryTitle', '整副牌面', 'Card gallery');
  text('settingsUsage', '用量记录', 'Usage records');
  const tabs = {
    notebook: ['记牌', 'Card memory'],
    history: ['牌桌记录', 'History'],
    metrics: ['AI 用量', 'API usage'],
  };
  document
    .querySelectorAll('[data-book-tab]')
    .forEach((button) => (button.textContent = pick(...tabs[button.dataset.bookTab])));
  $('creditsContent').innerHTML =
    `<div class="credits-list"><p>${pick('为四个人、两个搭档、一整晚的好牌而做。', 'For four players, two partnerships, and one more hand.')}</p><a class="credit-repo primary" href="https://github.com/tonyyunyang/80-fen-shengji" target="_blank" rel="noreferrer">Eighty · GitHub ↗</a><a class="credit-author" href="https://github.com/tonyyunyang" target="_blank" rel="noreferrer">Tony Yunyang ↗</a><hr><p>${pick('感谢 ChannonTian 提供的灵感。', 'Thanks to ChannonTian for the inspiration.')}</p><p>${pick('感谢 GPT6-Astra 的优质 token。', 'Thanks to GPT6-Astra for the excellent tokens.')}</p><p class="fine">${pick('视觉灵感：Balatro / LocalThunk。像素插画由 AI 生成，交互与引擎为 Eighty 实现。', 'Visual inspiration: Balatro / LocalThunk. AI-generated pixel artwork; interaction and engine by Eighty.')}</p><p class="fine">${pick('陪练参考源码保留 Apache-2.0 许可，详情见仓库。', 'The preserved practice strategy retains its Apache-2.0 license; details in the repository.')}</p></div>`;
}
$('rulesDialog').insertAdjacentHTML('beforeend', detailedRules());
$('menuArt').innerHTML = [
  { suit: 'S', rank: 11 },
  { suit: 'H', rank: 12 },
  { suit: 'D', rank: 13 },
  { suit: 'X', rank: 16 },
]
  .map(mini)
  .join('');
$('appearancePreview').innerHTML = [
  { suit: 'S', rank: 13 },
  { suit: 'H', rank: 12 },
  { suit: 'C', rank: 14 },
  { suit: 'D', rank: 10 },
]
  .map(mini)
  .join('');
labels();
applyAppearance();
$('galleryButton').onclick = () => {
  $('galleryContent').innerHTML =
    ['S', 'H', 'C', 'D']
      .map(
        (suit) =>
          `<section><h3>${SYMBOLS[suit]}</h3><div class="card-gallery">${[14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((rank) => mini({ suit, rank })).join('')}</div></section>`,
      )
      .join('') + `<div class="card-gallery">${[15, 16].map((rank) => mini({ suit: 'X', rank })).join('')}</div>`;
  $('galleryDialog').showModal();
};
$('closeGallery').onclick = () => $('galleryDialog').close();
$('settingsUsage').onclick = () => {
  bookTab = 'metrics';
  renderBook();
  $('bookDialog').showModal();
};
$('menuStart').onclick = () => {
  renderSetup();
  showScreen('setup');
};
$('setupBack').onclick = () => showScreen('menu');
$('continueGame').onclick = resumeGame;
$('settingsButton').onclick = () => {
  renderSetup();
  showScreen('settings');
};
$('settingsBack').onclick = () => showScreen('menu');
$('rulesButton').onclick = () => {
  rulesReturn = 'menu';
  $('rulesDialog').showModal();
};
$('creditsButton').onclick = () => $('creditsDialog').showModal();
$('closeCredits').onclick = () => $('creditsDialog').close();
$('closeBook').onclick = () => $('bookDialog').close();
$('closeLesson').onclick = $('skipLesson').onclick = () => $('lessonDialog').close();
$('closeTrick').onclick = () => $('trickDialog').close();
$('pauseRules').onclick = () => {
  rulesReturn = 'pause';
  $('pauseDialog').close();
  $('rulesDialog').showModal();
};
$('closeRules').onclick = () => $('rulesDialog').close();
$('rulesDialog').addEventListener('close', () => {
  if (rulesReturn === 'pause' && viewMode === 'game' && !$('pauseDialog').open) $('pauseDialog').showModal();
});
$('resumeGame').onclick = resumeGame;
$('pauseMenu').onclick = mainMenu;
$('pauseDialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  $('pauseDialog').close();
  resumeGame();
});
$('autoplay').onclick = async () => {
  try {
    await post('autoplay', { seat: viewer, enabled: !latest.autoplay.includes(viewer) });
    await resumeGame();
  } catch (error) {
    notify(error.message);
  }
};
$('closeRestart').onclick = $('cancelRestart').onclick = () => $('restartDialog').close();
$('confirmRestart').onclick = () => startMatch(true);
for (const [id, key] of Object.entries({
  fourColor: 'fourColor',
  cardMotion: 'motion',
  tableTexture: 'texture',
  showHints: 'hints',
  dragToPlay: 'dragToPlay',
  tableSound: 'sound',
  tableMusic: 'music',
}))
  $(id).onchange = (event) => {
    appearance[key] = event.target.checked;
    applyAppearance(true);
    if (key === 'sound' || key === 'music') sound.unlock().then(() => music.sync({ retry: true }));
  };
for (const id of ['handSize', 'tableSize', 'textSize'])
  $(id).onchange = (event) => {
    appearance[id] = Number(event.target.value);
    applyAppearance(true);
  };
$('soundVolume').oninput = (event) => {
  appearance.volume = Number(event.target.value);
  applyAppearance(true);
};
$('musicVolume').oninput = event => { appearance.musicVolume = Number(event.target.value); applyAppearance(true); };
$('soundPreview').onclick = () => sound.preview();
$('audioToggle').onclick = () => {
  const enabled = appearance.sound && appearance.volume > 0 || appearance.music && appearance.musicVolume > 0;
  appearance.sound = appearance.music = !enabled;
  if (!enabled) { appearance.volume ||= DEFAULT_PREFERENCES.volume; appearance.musicVolume ||= DEFAULT_PREFERENCES.musicVolume; }
  applyAppearance(true); sound.unlock().then(() => music.sync({ retry: true }));
};
$('effectQuality').onchange = (event) => {
  appearance.effects = event.target.value;
  applyAppearance(true);
  tableEffects.clear();
};
$('resetPreferences').onclick = () => {
  appearance = { ...DEFAULT_PREFERENCES };
  applyAppearance(true);
  sound.unlock().then(() => music.sync({ retry: true }));
};
$('trainingToggle').onchange = (event) => {
  appearance.learning = event.target.checked;
  quiz = null;
  quizKey = null;
  applyAppearance(true);
  if (appearance.learning) renderTraining(latest?.game);
  else $('training').innerHTML = '';
  render();
};
for (const button of document.querySelectorAll('[data-book-tab]'))
  button.onclick = () => {
    bookTab = button.dataset.bookTab;
    renderBook();
  };
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => handHover?.refresh());
for (const dialog of document.querySelectorAll('dialog'))
  dialog.addEventListener('toggle', () => {
    if (dialog.open) tableEffects.update(latest?.game, { active: false, motion: tableMotion });
  });
setupConnectionsDialog({
  state: () => latest,
  seatLabel: (index) => {
    const row = setupSeatRows(config.seats).find((row) => row.index === index);
    return row.label + ' · ' + row.hint;
  },
  post,
  refresh: refreshState,
  notify,
  onLinked: (index, profile, previous) => {
    const seat = config.seats[index];
    if (seat?.kind !== 'api' || (connectionFor(seat, latest?.connections || [])?.id || null) !== previous) return;
    seat.connectionId = profile.id;
    seat.provider = profile.provider;
    if (!profile.models.some((model) => model.id === seat.model)) seat.model = '';
    storeConfig();
    renderSetup();
    return true;
  },
});
enhanceDialogs();
document.addEventListener('visibilitychange', () => {
  presence();
  applyAppearance();
  render();
});
motionPreference.addEventListener('change', () => {
  applyAppearance();
  render();
});
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.target.matches('input,select,textarea')) return;
  if (document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (handDrag?.active) {
      handDrag.cancel();
      return;
    }
    if (selected.size) {
      selected.clear();
      render();
      return;
    }
    if (['settings', 'setup'].includes(viewMode)) showScreen('menu');
    else if (viewMode === 'game') pauseGame();
    return;
  }
  if (handDrag?.active) {
    if (event.key === 'Tab') handDrag.cancel();
    else {
      event.preventDefault();
      return;
    }
  }
  if (viewMode !== 'game') return;
  if (event.target.matches('.hand-slot') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    const cards = [...document.querySelectorAll('.hand-slot:not(:disabled)')],
      at = cards.indexOf(event.target),
      index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? cards.length - 1
            : Math.max(0, Math.min(cards.length - 1, at + (event.key === 'ArrowLeft' ? -1 : 1)));
    if (!cards[index]) return;
    event.preventDefault();
    const id = Number(cards[index].dataset.card);
    if (event.shiftKey) {
      setSelection(selectRange(latest.game.hand, selected, anchor ?? Number(event.target.dataset.card), id));
    }
    cards[index].focus();
    cards[index].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return;
  }
  if (
    event.key === 'Enter' &&
    event.target.closest('#handPanel') &&
    $('playCards') &&
    !$('playCards').disabled &&
    !event.target.matches('button:not(.hand-slot)')
  ) {
    event.preventDefault();
    $('playCards').click();
  }
});
let resizeFrame;
function resizeTable() {
  // Cancellation must happen before another pointer-up can submit the group.
  handDrag?.cancel(true);
  dealMotion.clear();
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(render);
}
window.addEventListener('resize', resizeTable);
window.visualViewport?.addEventListener('resize', resizeTable);
renderSetup();
renderMenu();
try {
  const initialResponse = await fetch('/api/state?seat=-1');
  if(!initialResponse.ok)throw new Error('Table service is not ready');
  const initial = await initialResponse.json();
  status = initial.providers;
  latest = initial;
  csrfToken = initial.csrf || '';
  if(initial.siteEdition?.results?.enabled){
    $('resultsNotice').hidden=false;
    const retained=initial.siteEdition.results.ipRetentionDays;
    $('resultsNotice').textContent=pick('完成的单局会私下保存胜方、完整牌谱（含四家初始手牌）和匿名会话 ID；未完成的局不进入成绩库。','Completed deals privately save their winner, complete replay (including all four initial hands) and anonymous session ID; unfinished deals do not enter the results archive. ')+
      (retained?pick('获取到的 IP 在 '+retained+' 天后清除。','Available IP addresses are cleared after '+retained+' days.'):pick('获取到的 IP 随牌谱保留。','Available IP addresses are retained with the replay.'));
  }
  if(initial.capabilities?.personalConnections===false){
    $('connectionsButton').hidden=true;
    $('apiSettingsTitle').textContent=pick('网站提供的 AI','AI provided by this site');
    $('apiSettingsHelp').textContent=pick('无需提交个人 key。网站提供的模型可在座位里选择；也可以一直使用免费陪练。','No personal key is needed. Choose a provided model in a seat, or keep using the free practice bots.');
  }else if(initial.siteEdition?.hosting==='workers-free'){
    $('apiSettingsTitle').textContent=pick('网站 AI 与自己的 API','Hosted AI & your API');
    $('apiSettingsHelp').textContent=pick('可以使用 Tony 提供的模型，或添加自己的服务地址和 key，例如 OpenRouter。','Use Tony’s supplied models or add your own service URL and key, such as OpenRouter.');
    $('connectionPrivacy').textContent=pick('key 仅保留在你这张牌桌的服务端内存中，不写入浏览器存储或存档。闲置 30 分钟或服务重启后需要重新填写。','Keys stay only in your table’s server memory, never in browser storage or saved games. Re-enter them after 30 minutes of inactivity or a service restart.');
  }
  // A retired host model must not leave a returning visitor stuck in setup.
  // Personal API choices keep their existing explicit configuration flow.
  config.seats = config.seats.map(seat => seat.kind === 'api' && seat.provider!=='mock' && (seat.connectionId?.startsWith('sponsored-')||initial.capabilities?.personalConnections===false) &&
    !initial.connections?.some(p => p.id === seat.connectionId && p.active && p.models.some(m => m.id === seat.model))
    ? { ...seat, kind: 'peilian', provider: 'mock', connectionId: undefined, model: '' } : seat);
  const hostedDefault = initial.connections?.find(p => p.sponsored && p.default && p.active);
  if (!hasSavedSetup && !initial.game && hostedDefault) {
    config.seats = defaultSeats().map((seat, index) => index ? {
      ...seat, kind: 'api', provider: hostedDefault.provider, connectionId: hostedDefault.id,
      model: hostedDefault.models[0].id, endgameAnalysis: false,
    } : seat);
  }
  if (config.setupDefaultsVersion < setupDefaultsVersion) {
    config.seats = config.seats.map((seat) =>
      seat.kind === 'api' && seat.provider !== 'mock' && !connectionFor(seat, initial.connections || [])
        ? { ...seat, kind: 'peilian', provider: 'mock', connectionId: undefined, model: '' }
        : seat,
    );
    config.setupDefaultsVersion = setupDefaultsVersion;
    storeConfig();
  }
  if (initial.game) viewer = initial.game.seats.findIndex((seat) => seat.kind === 'human');
  renderSetup();
  let returnToGame = false;
  try {
    returnToGame = sessionStorage.getItem('eighty-screen') === 'game';
  } catch {}
  if (initial.game && !initial.paused && returnToGame) {
    viewMode = 'game';
    $('mainMenu').hidden = true;
    $('gameView').hidden = false;
  }
  connect();
} catch (error) {
  connect();
  renderMenu();
  notify(t('本地服务暂未连接，正在重试。'));
}
