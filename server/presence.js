// Only the single-human browser mode needs presence protection. Headless bot
// games and shared-screen handoff mode keep their existing behavior.
export class HumanPresence {
  constructor(session, delayMs = 5000) { this.session = session; this.delayMs = delayMs; this.clients = new Map(); this.timer = null; this.seenGame = null; this.armedGame = null; }
  attach(seat, clientId, visible = true) {
    const token = Symbol(); this.clients.set(token, { seat, clientId, visible });
    this.check();
    return () => { this.clients.delete(token); this.check(); };
  }
  visibility(clientId, visible) {
    for (const client of this.clients.values()) if (client.clientId === clientId) client.visible = visible;
    this.check();
  }
  check() {
    const s = this.session, humans = s.state?.seats.map((seat, i) => seat.kind === 'human' ? i : -1).filter(i => i >= 0);
    const viewers = [...this.clients.values()].filter(c => humans?.length === 1 && c.seat === humans[0]);
    if (s.state && viewers.length) this.seenGame = s.state.id;
    if (!s.state || this.seenGame !== s.state.id || s.paused || s.state.score || humans?.length !== 1 || viewers.some(c => c.visible)) { this.stop(); return; }
    const gameId = s.state.id;
    // Public draw updates must not restart the grace period every 500ms.
    if (this.timer && this.armedGame === gameId) return;
    this.stop(); this.armedGame = gameId;
    this.timer = setTimeout(() => {
      if (s.state?.id === gameId && !s.paused && !s.state.score && ![...this.clients.values()].some(c => c.seat === humans[0] && c.visible)) s.pause(true, 'away');
    }, this.delayMs);
    this.timer.unref?.();
  }
  stop() { clearTimeout(this.timer); this.timer = null; this.armedGame = null; }
}
