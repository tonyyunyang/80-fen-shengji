import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Session } from './session.js';
import { Connections } from './connections.js';
import { HumanPresence } from './presence.js';

const token = () => randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const problem = (message, status) => Object.assign(new Error(message), { status });
export class BrowserSessions {
  constructor({ directory, hosted = false, allowLoopback = false, capacity = 32, idleMs = 30 * 60 * 1000 }) {
    this.directory = directory; this.hosted = hosted; this.allowLoopback = allowLoopback && !hosted;
    this.capacity = capacity; this.idleMs = idleMs; this.entries = new Map(); this.loading = new Map(); this.starts = new Map();
    this.timer = setInterval(() => this.sweep(), 60000); this.timer.unref();
  }
  async saved(id) {
    try { return JSON.parse(await readFile(join(this.directory, id + '.json'), 'utf8')); }
    catch { return null; }
  }
  async get(req, res, create = false) {
    const cookies = String(req.headers.cookie || '').split(';').map(v => v.trim());
    const cookieName = this.hosted ? '__Host-eighty' : 'eighty_' + (String(req.headers.host || '').split(':')[1] || 'local');
    let raw = cookies.find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    let id = /^[a-f0-9]{64}$/.test(raw || '') ? hash(raw) : null;
    let context = id && this.entries.get(id);
    if (context?.closed) { await context.writes; if (this.entries.get(id) === context) this.entries.delete(id); context = null; }
    if (context) { context.lastSeen = Date.now(); return context; }
    if (id && this.loading.has(id)) return this.loading.get(id);
    const saved = id ? await this.saved(id) : null;
    if (!saved && !create) throw problem('会话已过期，请刷新页面', 401);
    if (!saved) {
      const address = req.socket.remoteAddress || 'local', minute = Math.floor(Date.now() / 60000);
      if (this.starts.size > 1024) this.starts.clear();
      const prior = this.starts.get(address), rate = prior?.minute === minute ? prior.count + 1 : 1;
      this.starts.set(address, { minute, count: rate });
      if (rate > 12) throw problem('创建牌桌过于频繁，请稍后重试', 429);
      raw = token(); id = hash(raw);
      res.setHeader('set-cookie', cookieName + '=' + raw + '; HttpOnly; SameSite=Strict; Path=/' + (this.hosted ? '; Secure' : ''));
    }
    // A concurrent request must not construct a second controller for the same cookie.
    if (this.entries.has(id)) return this.entries.get(id);
    if (this.loading.has(id)) return this.loading.get(id);
    if (this.entries.size + this.loading.size >= this.capacity) throw problem('牌桌已满，请稍后重试', 503);
    const building = this.build(id, saved); this.loading.set(id, building);
    try { context = await building; this.entries.set(id, context); return context; }
    finally { this.loading.delete(id); }
  }
  async build(id, saved) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const connections = new Connections({ saved: saved?.connections || [], allowLoopback: this.allowLoopback });
    const context = { id, connections, csrf: token(), revision: 0, lastSeen: Date.now(), writes: Promise.resolve(), streams: new Set(), mutations: [],
      auditRows: Array.isArray(saved?.auditRows) ? saved.auditRows.slice(-2000) : [] };
    const persist = data => {
      if (context.closed) return;
      // No cookie, CSRF token or API key is part of this checkpoint.
      const content = JSON.stringify({ ...data, connections: connections.snapshot(), auditRows: context.auditRows });
      context.writes = context.writes.then(async () => {
        await writeFile(join(this.directory, id + '.tmp'), content, { mode: 0o600 });
        await rename(join(this.directory, id + '.tmp'), join(this.directory, id + '.json'));
      }).catch(() => { context.saveFailed = true; });
    };
    context.session = new Session({ env: {}, connections, persist, audit: entry => {
      if (context.closed) return;
      context.auditRows.push({ at: new Date().toISOString(), ...entry });
      if (context.auditRows.length > 2000) context.auditRows.shift();
    } });
    if (saved) {
      try { context.session.restore(saved); } catch { context.restoreFailed = true; }
    }
    context.presence = new HumanPresence(context.session);
    context.session.listeners.add(() => { context.revision++; context.presence.check(); });
    return context;
  }
  authorize(context, req) {
    const supplied = req.headers['x-eighty-csrf'];
    const expected = Buffer.from(context.csrf);
    const candidate = typeof supplied === 'string' ? Buffer.from(supplied) : null;
    if (!candidate || candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) throw problem('页面验证已过期，请刷新后重试', 403);
    const now = Date.now();
    context.mutations = context.mutations.filter(at => now - at < 60000);
    if (context.mutations.length >= 180) throw problem('操作过于频繁，请稍后重试', 429);
    context.mutations.push(now);
  }
  view(context, seat, restoreAvailable = false) {
    return { ...context.session.view(seat), connections: context.connections.list(), csrf: context.csrf, revision: context.revision,
      hosted: this.hosted, restoreAvailable, saveFailed: !!context.saveFailed, restoreFailed: !!context.restoreFailed };
  }
  async sweep() {
    const now = Date.now();
    for (const [id, context] of this.entries) if (now - context.lastSeen > this.idleMs) {
      context.connections.forget(); context.session.pause(true, 'expired'); context.presence.stop();
      context.closed = true;
      for (const stream of context.streams) stream.end();
      await context.writes;
      if (this.entries.get(id) === context) this.entries.delete(id);
    }
    // Hosted demo storage has a bounded retention period. Local saves remain.
    if (this.hosted) try {
      for (const file of await readdir(this.directory)) {
        if (!/^[a-f0-9]{64}\.json$/.test(file) || this.entries.has(file.slice(0, -5))) continue;
        if (now - (await stat(join(this.directory, file))).mtimeMs > 7 * 24 * 60 * 60 * 1000) await rm(join(this.directory, file));
      }
    } catch {}
  }
  async stop() {
    clearInterval(this.timer);
    for (const context of this.entries.values()) {
      context.connections.forget(); context.session.pause(true); context.presence.stop();
      for (const stream of context.streams) stream.end();
    }
    await new Promise(resolve => setImmediate(resolve));
    await Promise.all([...this.entries.values()].map(context => context.writes));
  }
}
