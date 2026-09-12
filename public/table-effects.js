import { EffectFlow } from './effect-flow.js';
import { pick } from './i18n.js';
import { relativePosition, playerName } from './pixel-view.js';

const colors = { gold: '#f4d58c', mint: '#95e3cf', rose: '#f7a6b1', blue: '#9dbdeb' };

export function createTableEffects({ preferences, sound, reducedMotion }) {
  const flow = new EffectFlow(), running = new Set();
  let board = null, layer = null, enabled = false, full = false, scoreFrame = 0, countTarget = null;

  function animate(node, frames, duration, { delay = 0, remove = false, easing = 'cubic-bezier(.16,1,.3,1)' } = {}) {
    if (!enabled || !node?.isConnected || !node.animate) { if (remove) node?.remove(); return; }
    const animation = node.animate(frames, { duration, delay, easing, fill: 'both' });
    const record = { node, animation, remove }; running.add(record);
    const finish = () => { running.delete(record); if (remove) node.remove(); animation.cancel(); };
    animation.onfinish = finish;
    return animation;
  }
  function clear() {
    cancelAnimationFrame(scoreFrame); scoreFrame = 0;
    if (countTarget) countTarget.node.textContent = countTarget.total;
    countTarget = null;
    for (const { node, animation, remove } of running) { animation.onfinish = null; animation.cancel(); if (remove) node.remove(); }
    running.clear(); layer?.replaceChildren();
  }
  function center(node, fallback) {
    if (!node || !board) return fallback || { x: 0, y: 0 };
    const rect = node.getBoundingClientRect(), root = board.getBoundingClientRect();
    const scale = Number(board.dataset.sceneScale) || 1;
    return { x: (rect.left + rect.width / 2 - root.left) / scale, y: (rect.top + rect.height / 2 - root.top) / scale };
  }
  function make(className, point, color = colors.gold) {
    if (!enabled || !layer || layer.childElementCount >= 80) return null;
    const node = document.createElement('span'); node.className = className;
    node.style.left = point.x + 'px'; node.style.top = point.y + 'px'; node.style.setProperty('--fx-color', color);
    layer.append(node); return node;
  }
  function particles(point, { count = 12, spread = 90, color = colors.gold, to = null, festive = false } = {}) {
    if (!full) return;
    for (let index = 0; index < count; index++) {
      const angle = index * 2.39996, reach = spread * (.45 + (index % 5) * .14);
      const node = make('fx-particle' + (festive && index % 3 === 0 ? ' fx-star' : ''), point,
        festive ? [colors.gold, colors.mint, colors.rose, colors.blue][index % 4] : color);
      if (!node) break;
      const x = Math.cos(angle) * reach, y = Math.sin(angle) * reach;
      const end = to ? { x: to.x - point.x, y: to.y - point.y } : { x, y: y + (festive ? 160 : 24) };
      animate(node, [
        { transform: 'translate(-50%,-50%) scale(0)', opacity: 0, offset: 0 },
        { transform: `translate(${x * .38}px,${y * .38 - 15}px) rotate(${index * 37}deg) scale(1)`, opacity: 1, offset: .22 },
        { transform: `translate(${end.x}px,${end.y}px) rotate(${index * 79 + 110}deg) scale(.15)`, opacity: 0, offset: 1 },
      ], to ? 760 : festive ? 1500 : 850, { delay: index * 13, remove: true, easing: 'cubic-bezier(.2,.55,.45,1)' });
    }
  }
  function ring(point, color = colors.gold, size = 100) {
    const node = make('fx-ring', point, color); if (!node) return;
    node.style.width = size + 'px'; node.style.height = size + 'px';
    animate(node, [{ transform: 'translate(-50%,-50%) scale(.35)', opacity: .65 },
      { transform: 'translate(-50%,-50%) scale(1.35)', opacity: 0 }], 650, { remove: true });
  }
  function label(point, title, detail, color = colors.gold, kind = 'capture') {
    const node = make('fx-label fx-' + kind, point, color); if (!node) return;
    node.dataset.effect = kind;
    const strong = document.createElement('strong'), small = document.createElement('small');
    strong.textContent = title; small.textContent = detail; node.append(strong, small);
    animate(node, [
      { transform: 'translate(-50%,-25%) scale(.65) rotate(-6deg)', opacity: 0, offset: 0 },
      { transform: 'translate(-50%,-50%) scale(1.06) rotate(-2deg)', opacity: 1, offset: .16 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(-2deg)', opacity: 1, offset: .68 },
      { transform: 'translate(-50%,-95%) scale(.96) rotate(0)', opacity: 0, offset: 1 },
    ], kind === 'capture' ? 1150 : 1400, { remove: true, easing: 'linear' });
  }
  function punch(node, size = 1.08) {
    animate(node, [{ scale: '1' }, { scale: String(size), offset: .25 }, { scale: '.98', offset: .6 }, { scale: '1' }], 450);
  }
  function winningFan(game, cue) {
    return board?.querySelector(`.played-slot[data-trick="${cue.index}"][data-seat="${cue.winner}"] .played-fan`);
  }
  function winnerTarget(game, winner) {
    return winner === game.viewer ? board?.querySelector('.hand-info') : board?.querySelector(`.seat.${relativePosition(game, winner)} .seat-name`);
  }
  function countResult(total) {
    const node = board?.querySelector('.result-score-number');
    if (!enabled || !node) return;
    cancelAnimationFrame(scoreFrame);
    countTarget = { node, total }; node.textContent = '0';
    const start = performance.now();
    function step(now) {
      if (!enabled || !node.isConnected || document.hidden) { node.textContent = total; scoreFrame = 0; countTarget = null; return; }
      const progress = Math.min(1, (now - start) / 950);
      node.textContent = Math.round(total * (1 - (1 - progress) ** 3));
      scoreFrame = progress < 1 ? requestAnimationFrame(step) : 0;
      if (progress === 1) countTarget = null;
    }
    scoreFrame = requestAnimationFrame(step);
  }
  function update(game, { active, motion }) {
    const scope = flow.scope, cues = flow.update(game, { active, motion });
    const options = preferences();
    enabled = active && options.motion && !reducedMotion() && options.effects !== 'off';
    full = options.effects === 'full';
    if (!enabled || scope !== flow.scope) clear();
    board = document.getElementById('cardTable'); layer = document.getElementById('tableEffects');
    if (!active || !board) return;
    // One sonic accent per state batch. The sound system is separately opt-in.
    const priority = ['result','collect','capture','declaration','trump_set','play','deal'];
    const audible = priority.map(type => cues.find(cue => cue.type === type)).find(Boolean);
    // With reduced motion there is no collection animation to wait for.
    // In animated play, score notes arrive only when the pile reaches its seat.
    if (audible) sound(audible.type === 'result' ? audible.winner === game.viewer % 2 || game.viewer < 0 ? 'win' : 'finish' : audible.type === 'capture' && !motion ? 'collect' : audible.type,
      { points: audible.points || 0, count: audible.count || 1,
        milestone: game.attackPoints >= 80 && game.attackPoints - (audible.points || 0) < 80 && audible.winner % 2 !== game.dealer % 2 });
    if (!enabled) return;
    for (const cue of cues) {
      if (cue.type === 'play') {
        const slot = board.querySelector(`.played-slot[data-trick="${cue.index}"][data-seat="${cue.seat}"]`);
        if (!slot || slot.dataset.phase !== 'play') continue;
        const point = center(slot.querySelector('.played-fan'));
        ring(point, colors.mint, cue.count > 1 ? 130 : 65);
        if (cue.count >= 2) particles(point, { count: cue.count >= 4 ? 16 : 7, spread: 65, color: colors.mint });
        if (slot.dataset.shape === 'tractor') label({ x: point.x, y: point.y - 88 }, pick('拖拉机','TRACTOR'), pick('连对出击','PAIRS IN SEQUENCE'), colors.mint, 'combo');
      }
      if (cue.type === 'declaration' || cue.type === 'trump_set') {
        const target = board.querySelector('.trump-tile'); punch(target, 1.13);
        const pile = cue.type === 'declaration' && board.querySelector(`.declaration-pile.${relativePosition(game, cue.seat)} .declaration-cards`);
        const point = center(pile || target);
        ring(point, colors.gold, 150); particles(point, { count: 18, spread: 100 });
        if (pile) label({ x: point.x, y: point.y - 92 }, cue.strength > 1 ? pick('强势亮主','TRUMP RAISED') : pick('亮主','TRUMP DECLARED'), playerName(game, cue.seat), colors.gold, 'declaration');
      }
      if (cue.type === 'capture') {
        const fan = winningFan(game, cue), point = center(fan, center(winnerTarget(game, cue.winner)));
        const own = game.viewer >= 0 && cue.winner % 2 === game.viewer % 2;
        const color = own ? colors.mint : colors.gold;
        // The winner is highlighted while every card stays readable during hold.
        animate(fan, [{ filter: 'drop-shadow(0 0 0 transparent)' },
          { filter: `drop-shadow(0 0 13px ${color})`, offset: .3 }, { filter: 'drop-shadow(0 0 0 transparent)' }], 800);
        const caption = center(board.querySelector(`.played-slot[data-trick="${cue.index}"][data-seat="${cue.winner}"] .play-caption`), point);
        label({ x: point.x, y: caption.y + 10 }, cue.points ? '+' + cue.points : pick('收下','TAKEN'),
          playerName(game, cue.winner) + pick(' · 收墩',' · TRICK WON'), color);
        if (cue.points) particles(point, { count: cue.points >= 20 ? 22 : 10, spread: 95, color });
      }
      if (cue.type === 'collect') {
        const scores = cue.winner % 2 !== game.dealer % 2 && cue.points > 0;
        const target = scores ? board.querySelector('.score-ticket strong') : winnerTarget(game, cue.winner);
        const from = center(winningFan(game, cue)), to = center(target);
        if (cue.points) particles(from, { count: Math.min(18, cue.points / 5 + 5), spread: 55, to, color: scores ? colors.gold : colors.mint });
        punch(target, scores ? 1.13 : 1.06);
        if (scores && game.attackPoints >= 80 && game.attackPoints - cue.points < 80) {
          ring(to, colors.rose, 170); particles(to, { count: 24, spread: 120, festive: true });
        }
      }
      if (cue.type === 'result') {
        const result = board.querySelector('.round-result'); if (!result) continue;
        const point = center(result);
        animate(result, [{ opacity: 0, scale: '.91', rotate: '-2deg' }, { opacity: 1, scale: '1.015', rotate: '.4deg', offset: .65 }, { opacity: 1, scale: '1', rotate: '0deg' }], 600);
        countResult(cue.total);
        const won = game.viewer < 0 || cue.winner === game.viewer % 2;
        if (won) {
          particles({ x: point.x - result.offsetWidth * .4, y: point.y - 150 }, { count: 28, spread: 200, festive: true });
          particles({ x: point.x + result.offsetWidth * .4, y: point.y - 150 }, { count: 28, spread: 200, festive: true });
        } else ring(point, colors.gold, 260);
      }
    }
  }
  return { update, clear, destroy: clear };
}
