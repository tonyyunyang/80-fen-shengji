import { mini } from './pixel-view.js';
import { buildNotebook } from '../src/notebook.js';
import { SYMBOLS } from '../src/cards.js';
import { pick, cardLabel } from './i18n.js';
import { escapeHtml as escape, patchHtml } from './dom.js';

export function renderNotebook(game, host) {
  const handoff = game?.pending && game.seats[game.pending.seat].kind === 'human' && game.pending.seat !== game.viewer && game.seats.filter(seat => seat.kind === 'human').length > 1;
  if (!game?.trump || handoff) {
    patchHtml(host, '<p class="fine">' + pick('定主后可查看公开记牌簿。只使用已出牌和你自己的信息。', 'The notebook opens after trump is set. It uses public plays and your own information only.') + '</p>');
    return;
  }
  const n = buildNotebook({ ...game, buriedKnown: game.score ? game.kitty : game.buriedKnown });
  const top = faces => faces.length ? faces.map(([suit, rank, count]) => cardLabel({ suit, rank }) + ' ×' + count).join(' / ') : pick('已出尽', 'None left');
  const seat = id => pick(['南', '东', '北', '西'][id], ['South', 'East', 'North', 'West'][id]);
  const suit = value => value === 'T' ? pick('主', 'T') : SYMBOLS[value];
  patchHtml(host, '<div class="notebook-jokers">' + n.jokers.map(joker => '<div><b>' + mini({suit:'X',rank:joker.rank}) + '</b><small>' +
    pick('已出 ', 'Played ') + joker.played + ' / 2 · ' + pick('你有 ', 'You hold ') + joker.held + '</small></div>').join('') + '</div>' +
    '<div class="notebook-suits">' + n.suits.map(row => '<div class="notebook-suit"><b>' + suit(row.suit) + '</b><span>' + escape(top(row.topUnplayed)) + '</span><small>' + row.played + pick(' 张已出', ' played') + '</small></div>').join('') + '</div>' +
    '<p class="fine">' + pick('每门尚未排除的最大牌，包含你的手牌与未知底牌；不代表对手一定持有。', 'Highest possible unplayed cards in each effective suit, including your hand and unknown kitty. This does not locate an opponent’s cards.') + '</p>' +
    '<p class="notebook-void"><b>' + pick('已证实断门', 'Proven voids') + '</b><br>' + (n.provenVoids.length ? n.provenVoids.map(v => seat(v.seat) + ' · ' + suit(v.suit) + pick(' · 第 ', ' · after trick ') + v.afterTrick).join('<br>') : pick('尚无公开跟牌证据。', 'No public follow has proved a void yet.')) + '</p>');
}
