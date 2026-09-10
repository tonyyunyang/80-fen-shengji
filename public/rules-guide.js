import { cardFace } from './card-art.js';
import { pick } from './i18n.js';

export function detailedRules() {
  const section = (zh, en, ...body) => '<section class="rules-detail"><h3>' + pick(zh, en) + '</h3>' + body.join('') + '</section>';
  const p = (zh, en) => '<p>' + pick(zh, en) + '</p>';
  const samples = '<div class="guide-cards">' + [16, 15].map(rank => '<div class="guide-card-example"><div class="face guide-joker ' + (rank === 16 ? 'joker-high' : 'joker-low') + '" role="img" aria-label="' + (rank === 16 ? 'High Joker / 大王' : 'Low Joker / 小王') + '">' + cardFace({ suit: 'X', rank }) + '</div><span>' + (rank === 16 ? 'High Joker · 大王' : 'Low Joker · 小王') + '</span></div>').join('') + '</div>';
  return samples + section('一桌牌的流程', 'A deal, step by step', p(
    '南北搭档，东西搭档。庄家一队守分，另一队称为闲家，争取 80 分。发牌与亮主同时进行；定主后庄家拿底牌，再扣回八张。庄家先领出，此后每墩赢家领出下一墩。手牌全部打完才算一局结束。',
    'Partners sit opposite. The dealer’s team defends; the other team attacks for 80 points. Bid while cards arrive. After trump is settled, the dealer takes the kitty and buries eight cards. The dealer leads first; each trick winner leads next. The deal ends when all hands are empty.')) +
    section('牌序与大小王', 'Card order & the two jokers', p(
      '彩色的大王高于黑白的小王。主牌从大到小：大王 ＞ 小王 ＞ 主花色级牌 ＞ 其他花色级牌 ＞ 主花色 A 到 2（跳过级牌）。无主时，各花色级牌并列，都在小王之下。副牌仍按 A、K、Q、J、10…2 排列，但级牌归主。同点同序时先出者大。',
      'The colored High Joker beats the black-and-white Low Joker. Trump order is: High Joker → Low Joker → the trump-suit level card → other level cards → ordinary trump-suit ranks from A down to 2, skipping the level. In no trump, all level cards tie below the Low Joker. Side suits run A, K, Q, J, 10…2, with level cards removed into trump. Equal strength belongs to the earlier play.')) +
    section('对子、拖拉机与甩牌', 'Pairs, tractors & throws', p(
      '对子是两张花色、点数相同的牌；两个或更多连续的对子组成拖拉机。打 7 时，66 与 88 连在一起；打 2 时，它们不相连。并列的副级牌对子不能彼此组成拖拉机。',
      'A pair is the two copies of one printed suit and rank. A tractor is two or more consecutive pairs. At level 7, 66 and 88 are consecutive because 7 is trump. At level 2, they are not. Equal-ranked off-suit level pairs cannot link to each other.'), p(
      '领出只能属于一个有效花色；所有主牌算一类。多组件的同门领出称为甩牌。若其他任一玩家（含搭档）能在同门压住某个组件，甩牌会缩为其中顶张最小的组件，不罚分。',
      'Lead one effective suit; all trumps count as one suit. Leading several components together is a throw. If any other player, including your partner, can beat a component in that suit, the throw is reduced to its lowest-top component, with no point fine.')) +
    section('怎么跟牌', 'How to follow', p(
      '必须跟相同张数，并尽可能跟足领出的有效花色。手中有对子时须按要求跟足对子；有足够长的拖拉机时须跟，默认有较短拖拉机也须先跟最长可用的较短拖拉机。没有该门时可垫牌或用主牌杀，但只有结构匹配的牌组才能争夺本墩。',
      'Play the same number of cards as the lead, following as many cards of its effective suit as you hold. Supply required pairs. Follow a tractor of the required length if possible; by default, otherwise supply your longest available shorter tractor. When void, discard or ruff with trump. A play can compete to win only when its component structure matches the lead.')) +
    section('亮主与反主', 'Bids & counterbids', p(
      '收到一张级牌可亮该花色；同花色级牌对子更强，其次是小王对与大王对（均为无主）。只能用已经收到的牌；不能反自己，但可把自己的单张亮主加固为同花色对子。庄家已确定时，反主不会改变庄家；首次争庄时，最后亮主者坐庄，无人亮则第一位接牌者坐庄。',
      'One received level card bids its suit. A matching level pair is stronger; a Low Joker pair and then a High Joker pair are stronger still and bid no trump. Use only received cards. You cannot counter yourself, but may reinforce your single bid into its matching pair. A known dealer keeps the role after counterbids. In a dealer contest, the final bidder deals; with no bid, the first taker deals.')) +
    section('分数与升级', 'Points & advancing', p(
      '两副牌共有 200 牌面分：5 记 5 分，10、K 各记 10 分。闲家赢最后一墩才抠底，底牌分乘以最后领出张数的两倍。例如最后领出对子，底牌 20 分加计 80 分。',
      'The two decks contain 200 face points: 5 is five; 10 and K are ten each. Only attackers who win the final trick collect the kitty bonus, at twice the final lead’s card count. For example, a final pair lead multiplies a 20-point kitty by four, adding 80 points.'), p(
      '闲家得 0 分，庄家升 3 级；低于 40 分升 2 级；40–75 分升 1 级。80–115 分闲家上台但不升级；120–155 分升 1 级，此后每 40 分多升 1 级（实际分数是 5 的倍数）。庄家守住后，对家下局坐庄；闲家上台后，原庄家的下一家坐庄。',
      'Defenders advance three levels at zero attacker points, two below 40, and one from 40 through 75. At 80 through 115, attackers take over without a level gain. From 120 through 155 they gain one level, then another per 40 points. Scores occur in multiples of five. After a defense, the dealer’s partner deals next. After a takeover, the previous dealer’s next seat deals.'), p(
      '默认必打 2、5、10、K：跨级会停在关卡，必须在该级坐庄守住才能越过。打过 A 赢得整场。速通模式按 2 → 5 → 10 → K → A，每次正升级至多前进一格，不设必打关卡；零级上台仍不升级。',
      'Mandatory levels are 2, 5, 10 and K. A jump stops at a gate; defend it successfully before passing it. Advance past A to win the match. Fast mode uses 2 → 5 → 10 → K → A, at most one step for a positive gain, without gates. A zero-level takeover still gives no advance.')) +
    section('操作与可选重发', 'Controls & optional redeals', p(
      '点牌选择，双击选同牌对子；方向键移动，空格选牌，Shift 连选，Enter 提交，Escape 清空。“帮我选牌”只帮助合法选牌，不保证策略。“回看”可看完整一墩；“下一局”保留升级进度；“重新开始”双方回到 2。',
      'Click cards to select, double-click for a pair. Use arrows to move, Space to select, Shift for a range, Enter to submit and Escape to clear. Help select supplies a legal selection, without a strength guarantee. Review shows a full trick. Next deal preserves levels; Restart resets both teams to 2.'), p(
      '重发默认关闭。开启时，符合低分（至多 15 分）或少主（至多 3 张主）条件的闲家可申请，最多重发三次。可选择保留已有庄家，或重新争庄。界面中只会出现当前合法的重发选择。',
      'Redeals are off by default. When enabled, attackers with at most 15 points or at most three trumps may request one, up to three times. Choose to retain the known dealer or reopen the dealer contest. Only currently legal choices are offered.'));
}
