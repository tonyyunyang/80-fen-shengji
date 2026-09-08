import { SYMBOLS, rankLabel, cardLabel, effectiveSuit } from '../src/cards.js';
import { classify } from '../src/rules.js';
import { escapeHtml as escape } from './dom.js';
import { SUIT_NAMES, tableFacts, tableScope } from './table-flow.js';

const positions = ['south', 'east', 'north', 'west'];
const directions = ['南', '东', '北', '西'];
export const seatLabel = (game, seat) => directions[seat] + '家' + (seat === game.viewer ? '（你）' : game.viewer >= 0 && seat % 2 === game.viewer % 2 ? '（搭档）' : '');
export const cardBack = () => '<span class="card-back" aria-hidden="true"><span>80</span></span>';
const stack = () => '<span class="back-stack" aria-hidden="true">' + cardBack().repeat(3) + '</span>';

export function tableOverview(game, motion) {
  if (!game) return '';
  const facts = tableFacts(game), red = ['H', 'D'].includes(facts.suit);
  const role = facts.settled && game.viewer >= 0 ? game.viewer === facts.dealer ? '你坐庄' : game.viewer % 2 === facts.dealer % 2 ? '你与庄家同队' : '你是闲家' : '南北搭档 · 东西搭档';
  let phase = '';
  if (motion) phase = '第 ' + (motion.trick.index + 1) + ' 墩 · ' + seatLabel(game, motion.trick.winner) + ' 收牌 · ' + motion.trick.points + ' 分';
  else if (game.phase === 'dealing') phase = '正在发牌 · 已发 ' + game.dealt + ' / 100 张';
  else if (game.phase === 'closing') phase = '发牌完毕 · 最后反主时间';
  else if (game.phase === 'bury') phase = seatLabel(game, game.dealer) + '扣八张底牌';
  else if (game.phase === 'rebel') phase = '确认是否重新发牌';
  else if (game.score) phase = '本局结束 · 共 ' + game.tricks.length + ' 墩';
  else if (game.pending?.phase === 'follow') {
    const suit = effectiveSuit(game.plays[0].cards[0], game.trump);
    phase = '第 ' + facts.liveTrick + ' 墩 · ' + seatLabel(game, game.pending.seat) + '跟牌 · ' + game.plays[0].cards.length + ' 张' + (suit === 'T' ? '主牌' : SUIT_NAMES[suit]);
  } else if (game.pending) phase = '第 ' + facts.liveTrick + ' 墩 · ' + seatLabel(game, game.pending.seat) + '领出';
  return '<section class="table-overview" id="dealInfo" aria-label="本局信息"><div class="deal-facts">' +
    '<div class="level-fact"><span>本局打</span><strong>' + (facts.rank === null ? '待定' : rankLabel(facts.rank)) + '</strong><small>' + (facts.rank === null ? '南北 ' + rankLabel(game.match.levels[0]) + ' · 东西 ' + rankLabel(game.match.levels[1]) : '级牌都算主') + '</small></div>' +
    '<div class="suit-fact' + (red ? ' red' : '') + '"><span>' + facts.suitLabel + '</span><strong><i aria-hidden="true">' + (facts.suit ? SYMBOLS[facts.suit] : facts.settled || game.declaration ? '◇' : '—') + '</i>' + facts.suitName + '</strong></div>' +
    '<div class="dealer-fact"><span>' + facts.dealerLabel + '</span><strong>' + (facts.dealer === null ? '抢庄中' : seatLabel(game, facts.dealer)) + '</strong><small>' + role + '</small></div></div>' +
    '<div class="round-progress" id="roundProgress">' + escape(phase) + '</div></section>';
}

export function centerDeck(game, clock) {
  if (!['dealing', 'closing', 'bury', 'rebel'].includes(game.phase)) return '';
  if (game.phase === 'bury' || game.phase === 'rebel') return '<div class="kitty-wait" aria-hidden="true"><span class="empty-stack"></span><small>' + (game.phase === 'bury' ? '等待庄家扣底' : '确认是否重发') + '</small></div>';
  return '<div class="draw-deck" aria-label="牌堆还剩 ' + (108 - game.dealt) + ' 张，含八张底牌">' + stack() +
    '<span class="deck-count">' + (game.phase === 'closing' ? '底牌 · 8 张' : '牌堆 · ' + (108 - game.dealt) + ' 张') + '</span>' +
    (game.phase === 'closing' && game.dealing === 'continuous' ? '<div class="deck-closing"><span>还有人反主吗？</span><b role="timer" data-closing-at="' + (clock?.closingAt || 0) + '" data-closing-remaining="' + (clock?.pausedRemaining || 0) + '"></b></div>' :
      '<small>发牌不停 · 随时亮主</small>') + '</div>';
}

export function collectedMarker(game, seat, motion) {
  const last = game?.tricks.at(-1);
  if (!last || last.winner !== seat || motion) return '';
  return '<span class="won-marker" aria-label="' + seatLabel(game, seat) + '收了上一墩，' + last.points + ' 分">' + stack() + '<span>上一墩收牌<small>' + last.points + ' 分</small></span></span>';
}

export function lastTrickSummary(game, motion) {
  const last = game.tricks.at(-1);
  if (!last) return '<div class="last-trick-summary empty">还没有完成的一墩</div>';
  return '<button class="last-trick-summary" data-review-trick="' + last.index + '"><span>' + (motion ? '本墩收牌' : '上一墩') + '</span><strong>' + seatLabel(game, last.winner) + ' 收</strong><b>' + last.points + ' 分</b><small>回看 ↗</small></button>';
}

export function trickPlays(game, motion, mini, narrow = false, tableWidth = 800) {
  const plays = motion?.trick.plays || game.plays, index = motion?.trick.index ?? game.tricks.length;
  const winner = motion?.trick.winner;
  return plays.map((play, order) => {
    // Leave room between adjacent compass positions, without clipping a 10.
    const wideLimit = Math.max(2, Math.min(5, Math.floor((tableWidth * .18 - 44) / 32) + 1));
    const visible = play.cards.slice(0, narrow ? play.seat % 2 ? 2 : 3 : wideLimit), shape = classify(play.cards, game.trump);
    const kind = ({ single: '单张', pair: '对子', tractor: '拖拉机', throw: order === 0 ? '甩牌' : '散牌' })[shape?.type] || '跟牌';
    const caption = (motion && winner === play.seat ? directions[play.seat] + '家收 · ' + motion.trick.points + ' 分' : directions[play.seat] + '家 · ' + (order === 0 ? '领出' : '跟牌')) + (narrow ? ' · ' + play.cards.length + '张' : '');
    return '<div class="played-slot ' + positions[play.seat] + (motion && winner === play.seat ? ' trick-winner' : '') + '" data-key="trick-' + tableScope(game) + ':' + index + ':' + play.seat + '" data-phase="' + (motion?.phase || 'play') + '"' +
      (motion ? ' data-winner="' + positions[winner] + '"' : '') + '><button class="played-fan" data-review-trick="' + index + '" aria-label="' + escape(seatLabel(game, play.seat) + '，' + caption + '，' + play.cards.map(cardLabel).join(' ') + '，点击查看完整一墩') + '">' +
      visible.map(card => '<span class="flip-card" data-key="face-' + card.id + '"><span class="flip-inner"><span class="card-front">' + mini(card) + '</span>' + cardBack() + '</span></span>').join('') +
      (visible.length < play.cards.length ? '<span class="fan-overflow" aria-hidden="true">＋' + (play.cards.length - visible.length) + '</span>' : '') +
      '</button><span class="play-caption">' + caption + '</span><span class="play-kind">' + kind + ' · ' + play.cards.length + ' 张' + (visible.length < play.cards.length ? ' · 点开看全' : '') + '</span></div>';
  }).join('');
}

export function kittyPocket(game) {
  return game.trump && !['bury', 'rebel'].includes(game.phase) ? '<div class="kitty-pocket" aria-label="已扣八张底牌">' + stack() + '<small>底牌 · 8 张</small></div>' : '';
}
