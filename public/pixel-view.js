import { pick, t, cardLabel, rankLabel, cardCount, seatName } from './i18n.js';
import { SYMBOLS } from '../src/cards.js';
import { classify } from '../src/rules.js';
import { escapeHtml as escape } from './dom.js';
import { cardFace, cardBack } from './card-art.js';
import { tableFacts, tableScope } from './table-flow.js';

export const positions = ['south','east','north','west'];
export const levelLabel = rank => rank > 14 ? pick('通关','Complete') : rankLabel(rank);
export function arrivingCard(previous, next) {
  if (!next || next.dealing !== 'continuous' || !['dealing','closing'].includes(next.phase)) return null;
  const known = new Set(previous && previous.id === next.id ? previous.hand.map(card => card.id) : []);
  return next.hand.find(card => !known.has(card.id)) || null;
}
export const relativePosition = (game, seat) => positions[(seat - Math.max(0,game.viewer) + 4) % 4];
export function playerName(game,seat){const raw=game.seats[seat].name;if(['You','你','S','E','N','W','南家','东家','北家','西家'].includes(raw))return seat===game.viewer?pick('你','You'):pick(['南家','东家','北家','西家'][seat],['South','East','North','West'][seat]);return seatName(game.seats[seat]);}
export const seatLabel = (game,seat) => playerName(game,seat)+(seat===game.viewer?pick('（你）',' (you)'):game.viewer>=0&&seat%2===game.viewer%2?pick('（搭档）',' (partner)'):'');
export const mini = card => `<span class="mini" role="img" aria-label="${escape(cardLabel(card))}"><span class="face" data-suit="${card.suit}" aria-hidden="true">${cardFace(card)}</span></span>`;

// Accepted public declarations only. Never infer another seat's eligibility.
export function displayedDeclarations(game) {
  if (!['dealing','closing'].includes(game.phase)) return [];
  const from=game.events.findLast(event=>event.type==='deal_started')?.seq??-1, seats=new Map();
  for(const event of game.events)if(event.seq>=from&&event.type==='declaration'){
    const row=seats.get(event.seat)||{seat:event.seat,cards:[]};
    for(const card of event.cards||[])if(!row.cards.some(known=>known.id===card.id))row.cards.push(card);
    seats.set(event.seat,row);
  }
  return [...seats.values()];
}
export function declarationMarkup(game) {
  return displayedDeclarations(game).map(row=>`<div class="declaration-pile ${relativePosition(game,row.seat)}${game.declaration?.seat===row.seat?' current':''}" data-key="declared-${tableScope(game)}-${row.seat}" aria-label="${escape(seatLabel(game,row.seat))} ${pick('亮出的牌','declared cards')}"><div class="declaration-cards">${row.cards.map(card=>`<span data-key="shown-${card.id}">${mini(card)}</span>`).join('')}</div><span>${escape(playerName(game,row.seat))} · ${game.declaration?.seat===row.seat?pick('当前亮主','Current declaration'):pick('已亮出','Revealed')}</span></div>`).join('');
}

export function portrait(kind=0) {
  const coat=['#d1aa64','#845f86','#668899','#869765'][kind%4],skin=['#c99874','#c3987e','#caaa8a','#d3b394'][kind%4];
  const rect=(x,y,w,h,fill)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  return '<svg class="portrait" viewBox="0 0 26 30" aria-hidden="true" shape-rendering="crispEdges">'+
    [[3,24,20,6,'#151e2b'],[5,21,16,8,coat],[8,17,10,8,skin],[6,9,14,11,skin],[5,7,15,5,'#292b3b'],[4,6,18,4,coat],[8,2,11,7,coat],[8,12,2,2,'#252233'],[16,12,2,2,'#252233'],[12,16,4,1,'#7c4c4b'],[9,21,7,4,'#e7d8b9'],[13,24,2,5,'#303043']].map(args=>rect(...args)).join('')+'</svg>';
}

export function pixelSeat(game, index, kind, state, motion) {
  const position=relativePosition(game,index),facts=tableFacts(game),isSelf=index===game.viewer;
  const bidding=game.dealing==='continuous'&&['dealing','closing'].includes(game.phase);
  const active=!bidding&&!state.paused&&game.pending?.seat===index;
  const thinking=active&&state.busy?.seat===index&&state.busy.api;
  const relation=isSelf?pick('你','You'):game.viewer<0?'':index%2===game.viewer%2?pick('搭档','Partner'):pick('对手','Opponent');
  const title=game.viewer>=0&&position==='north'?pick('对家 · 搭档','Across · partner'):game.viewer>=0&&position==='west'?pick('左手对手','Left opponent'):game.viewer>=0&&position==='east'?pick('右手对手','Right opponent'):escape(playerName(game,index));
  const exposed=displayedDeclarations(game).find(row=>row.seat===index)?.cards.length||0;
  const count=game.handSizes[index]-exposed,last=game.tricks.at(-1);
  return `<div class="seat ${position}${isSelf?' self-seat':''}${active?' active':''}${thinking?' thinking':''}" data-key="seat-${index}" data-seat="${index}" aria-label="${escape(seatLabel(game,index)+' · '+kind)}" aria-busy="${!!thinking}">`+
    portrait(isSelf?3:relation===pick('搭档','Partner')?0:position==='west'?1:2)+
    `<span class="seat-name">${title}</span><span class="seat-role" title="${escape(kind)}">${escape(kind)}</span>`+
    (facts.dealer===index?`<span class="dealer" title="${escape(facts.dealerLabel)}">${pick('庄','D')}</span>`:'')+
    `<div class="seat-hand"><div class="backs" aria-hidden="true">${cardBack().repeat(Math.min(7,count))}</div><span class="seat-count">${cardCount(count)}${exposed?` <small>+ ${exposed} ${pick('已亮','shown')}</small>`:''}</span></div>`+
    (thinking?`<span class="thinking-dots" aria-label="${pick('思考中','Thinking')}"><i></i><i></i><i></i></span>`:'')+
    '<div class="seat-history">'+(last?.winner===index&&!motion?`<button class="won-marker" data-review-trick="${last.index}">${pick('上一墩','Last trick')} +${last.points}</button>`:'')+'</div></div>';
}

export function dealMarkers(game) {
  const facts=tableFacts(game),ownDefends=game.viewer>=0&&facts.dealer!==null&&game.viewer%2===facts.dealer%2;
  const score=game.score?.total??game.attackPoints;
  const kitty=game.trump&&!['bury','rebel'].includes(game.phase)?`<span class="kitty-pocket"><span class="kitty-backs" aria-hidden="true">${cardBack().repeat(3)}</span><span>${pick('底牌 · 8 张','Kitty · 8')}</span></span>`:'';
  return `<div class="trump-marker" id="dealInfo" role="group" aria-label="${escape(facts.suitLabel+' · '+facts.suitName)}"><div class="trump-tile" data-suit="${facts.suit||'X'}"><strong>${facts.rank===null?'—':rankLabel(facts.rank)}</strong><span>${facts.suit?SYMBOLS[facts.suit]:facts.settled?'◇':'?'}</span></div><span class="trump-copy"><b>${facts.suitName}</b><small>${facts.settled?pick('级牌与王都算主','Level cards and jokers are trump'):facts.suitLabel}</small></span>${kitty}</div>`+
    `<div class="score-ticket ${ownDefends?'defending':'attacking'}" data-target-reached="${score>=80}"><b class="team-role">${facts.dealer===null?pick('等待定庄','Dealer undecided'):game.viewer<0?pick('攻守记分','Team score'):ownDefends?pick('我方 · 防守','WE DEFEND'):pick('我方 · 攻击','WE ATTACK')}</b><span>${game.viewer<0||facts.dealer===null?pick('攻方得分','Attacker points'):ownDefends?pick('对方攻分','Opponent points'):pick('我方攻分','Our points')}</span><strong><span class="score-number">${score}</span> <small>/ 80</small></strong><div class="score-track" aria-hidden="true"><i data-live-style data-score-progress="${Math.min(1,Math.max(0,score/80))}"></i><b></b></div><span>${ownDefends?pick('守住 80 分以下','Keep them below 80'):pick('拿到 80 分上台','Reach 80 to take over')}</span></div>`;
}

export const closingClock = clock => `<b class="closing-clock" role="timer" data-closing-at="${clock?.closingAt||0}" data-closing-remaining="${clock?.pausedRemaining||0}"></b>`;

export function deckMarkup(game) {
  if (!['dealing','closing','rebel','bury'].includes(game.phase)) return '';
  if(game.phase==='bury')return game.viewer===game.dealer?'':`<div class="deck-center"><div class="deck-stack">${cardBack().repeat(3)}</div><strong>${escape(playerName(game,game.dealer))} ${pick('正在扣底','is burying')}</strong><small>${pick('选择八张底牌后开始出牌','Play begins after eight cards are buried')}</small></div>`;
  if(game.phase==='rebel')return `<div class="deck-center"><span>${pick('确认是否重发','Confirming redeal')}</span></div>`;
  return `<div class="deck-center" aria-hidden="true"><div class="deck-stack">${cardBack().repeat(3)}</div></div>`;
}

export function trickMarkup(game,motion,narrow=false) {
  const plays=motion?.trick.plays||game.plays,index=motion?.trick.index??game.tricks.length;
  return plays.map((play,order)=>{
    const position=relativePosition(game,play.seat),visible=play.cards.slice(0,narrow?2:4),shape=classify(play.cards,game.trump);
    const type=({single:t('单张'),pair:t('对子'),tractor:t('拖拉机'),throw:order===0?t('甩牌'):t('散牌')})[shape?.type]||t('跟牌');
    const turn=order===0?t('领出'):t('跟牌');
    // Keep the visible caption short enough to retain the seat name on phones.
    // The accessible label below still gives both turn role and full structure.
    const caption=order===0?turn:shape?.type==='pair'||shape?.type==='tractor'?type:turn;
    return `<div class="played-slot ${position}" data-live-style data-position="${position}" data-trick="${index}" data-seat="${play.seat}" data-shape="${shape?.type||'single'}" data-key="trick-${tableScope(game)}:${index}:${play.seat}" data-phase="${motion?.phase||'play'}"${motion?` data-winner="${relativePosition(game,motion.trick.winner)}"`:''}><button class="played-fan" data-review-trick="${index}" aria-label="${escape(seatLabel(game,play.seat)+' · '+turn+' · '+type+' · '+play.cards.map(cardLabel).join(' '))}">`+
      visible.map(card=>`<span class="flip-card" data-key="played-${card.id}"><span class="flip-inner"><span class="card-front">${mini(card)}</span>${cardBack()}</span></span>`).join('')+
      (visible.length<play.cards.length?`<span class="fan-overflow">+${play.cards.length-visible.length}</span>`:'')+`</button><span class="play-caption"><span class="play-seat">${escape(playerName(game,play.seat))}</span><span> · ${caption} · ${cardCount(play.cards.length)}</span></span></div>`;
  }).join('');
}


export function resultMarkup(game) {
  if (!game.score) return '';
  const winner=game.score.attackersWin?1-game.dealer%2:game.dealer%2;
  const headline=game.match.winner>=0?(game.viewer<0?pick('本场结束','Match complete'):game.match.winner===game.viewer%2?pick('赢下整场','Match won'):pick('对方赢下整场','Opponents win the match')):game.viewer<0?(game.score.attackersWin?t('闲家上台'):t('庄家守住了')):winner===game.viewer%2?pick('我方胜利','Our team wins'):pick('对方获胜','Opponents win');
  const kittyTaken=game.tricks.at(-1).winner%2!==game.dealer%2,bonus=kittyTaken?game.score.kittyPoints*game.score.multiplier:0;
  const outcome=game.viewer<0?'neutral':winner===game.viewer%2?'won':'lost';
  return `<section class="round-result" data-key="result-${escape(game.id)}-${game.match.round}-${game.viewer}" data-outcome="${outcome}" aria-label="${pick('本局结算','Round result')}"><div class="result-medallion" aria-hidden="true">${outcome==='lost'?'♠':'✦'}</div><span class="eyebrow">${pick('第','DEAL ')} ${game.match.round} ${pick('局结束','COMPLETE')}</span><h2>${headline}</h2><div class="result-score" role="group" aria-label="${game.score.total} ${pick('攻方总分','attacker points')}"><span class="result-score-number" data-preserve aria-hidden="true">${game.score.total}</span><small aria-hidden="true">${pick('攻方总分','attacker points')}</small></div><p class="result-equation">${game.score.attackPoints} ${pick('牌面分','trick points')} + ${game.score.kittyPoints} × ${kittyTaken?game.score.multiplier:0} ${pick('底牌','kitty')} = ${game.score.total}</p><p>${pick('南北','South / North')} ${levelLabel(game.match.levels[0])} · ${pick('东西','East / West')} ${levelLabel(game.match.levels[1])}</p><div class="result-kitty">${game.kitty.map(mini).join('')}</div><div class="dialog-actions">`+
    (game.phase==='round_over'?`<button class="primary" id="nextDeal">${pick('下一局','Next deal')} →</button>`:'')+`<button class="secondary" id="resultMenu">${pick('返回主菜单','Main menu')}</button></div><small>${bonus?pick('攻方抠底得分','Attackers captured the kitty'):pick('庄家方保住了底牌','Defenders protected the kitty')}</small></section>`;
}
