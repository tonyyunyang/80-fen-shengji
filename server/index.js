import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { BrowserSessions } from './browser-sessions.js';
const root = resolve(import.meta.dirname, '..');
// Web tables are BYOK. CLI evaluators may load .env, but the web process must
// neither load that credential file nor retain deployment provider keys.
for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'QWEN_API_KEY', 'KIMI_API_KEY']) delete process.env[name];
const dataDirectory = resolve(root, process.env.EIGHTY_DATA_DIR || 'data');
await mkdir(dataDirectory, { recursive: true });
const publicOrigin = process.env.EIGHTY_PUBLIC_ORIGIN || '';
if (publicOrigin && (new URL(publicOrigin).protocol !== 'https:' || new URL(publicOrigin).origin !== publicOrigin)) throw new Error('EIGHTY_PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash');
const bindHost = process.env.HOST || '127.0.0.1';
if (!publicOrigin && !['127.0.0.1', 'localhost'].includes(bindHost)) throw new Error('Public listening requires EIGHTY_PUBLIC_ORIGIN and an HTTPS proxy');
const sessions = new BrowserSessions({ directory: join(dataDirectory, 'browser-sessions'), hosted: !!publicOrigin,
  allowLoopback: process.env.EIGHTY_ALLOW_LOCAL_PROVIDERS === '1',
  capacity: Math.max(1, Math.min(256, Number(process.env.EIGHTY_MAX_SESSIONS) || 32)) });
let legacy = null;
if (!publicOrigin) try { legacy = JSON.parse(await readFile(join(dataDirectory, 'session.json'), 'utf8')); } catch {}
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }); res.end(JSON.stringify(body)); };
const body = async (req) => {
  let size = 0, result = '';
  for await (const chunk of req) { size += chunk.length; if (size > 131072) throw new Error('请求过大'); result += chunk; }
  return JSON.parse(result || '{}');
};
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
    if (publicOrigin ? host !== new URL(publicOrigin).host : !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return json(res, 403, { error: 'Host rejected' });
    if (req.headers['sec-fetch-site'] === 'cross-site' || req.headers.origin && req.headers.origin !== (publicOrigin || 'http://' + host)) return json(res, 403, { error: 'Origin rejected' });
    const url = new URL(req.url, 'http://' + host);
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ready: true });
    const api = url.pathname.startsWith('/api/');
    const context = api ? await sessions.get(req, res, req.method === 'GET' && url.pathname === '/api/state') : null;
    const session = context?.session, presence = context?.presence;
    const view = seat => sessions.view(context, seat, !!legacy?.state && !session.state);
    if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, view(Number(url.searchParams.get('seat') ?? -1)));
    if (url.pathname === '/api/events' && req.method === 'GET') {
      const viewer = Number(url.searchParams.get('seat') ?? -1);
      const clientId = (url.searchParams.get('client') || '').slice(0, 80);
      const detach = clientId ? presence.attach(viewer, clientId, url.searchParams.get('visible') !== 'false') : () => {};
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const listener = () => res.write('data: ' + JSON.stringify(view(viewer)) + '\n\n');
      listener(); session.listeners.add(listener);
      context.streams.add(res);
      const heartbeat = setInterval(() => {
        res.write(': ping\n\n');
        if ([...presence.clients.values()].some(client => client.visible)) context.lastSeen = Date.now();
      }, 20000);
      req.on('close', () => { clearInterval(heartbeat); session.listeners.delete(listener); context.streams.delete(res); detach(); });
      return;
    }
    if (url.pathname.startsWith('/api/') && req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'JSON required' });
      sessions.authorize(context, req);
      const data = await body(req);
      if (url.pathname === '/api/start') session.start(data);
      else if (url.pathname === '/api/action') session.human(data);
      else if (url.pathname === '/api/pause') session.pause(data.paused === true);
      else if (url.pathname === '/api/next') session.next();
      else if (url.pathname === '/api/restart') session.restart();
      else if (url.pathname === '/api/restore-local') {
        if (publicOrigin || !legacy?.state || session.state) throw new Error('没有可恢复的本地牌局');
        session.restore(legacy); legacy = null;
      }
      else if (url.pathname === '/api/connections/save') {
        const id = context.connections.save(data); if (session.state) session.pause(true, 'credentials'); else session.save();
        return json(res, 200, { ok: true, id });
      }
      else if (url.pathname === '/api/connections/discover') {
        return json(res, 200, await context.connections.discover(data));
      }
      else if (url.pathname === '/api/connections/forget' || url.pathname === '/api/connections/delete') {
        if (url.pathname.endsWith('/delete')) context.connections.remove(data.id); else context.connections.forget(data.id);
        if (session.state) session.pause(true, 'credentials'); else session.save();
      }
      else if (url.pathname === '/api/autoplay') session.setAutoplay(data.seat, data.enabled === true);
      else if (url.pathname === '/api/presence') {
        if (typeof data.clientId !== 'string' || typeof data.visible !== 'boolean') throw new Error('无效在线状态');
        presence.visibility(data.clientId, data.visible);
      }
      else return json(res, 404, { error: 'Unknown endpoint' });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/replay' && req.method === 'GET') {
      const record = view(Number(url.searchParams.get('seat') ?? -1));
      res.setHeader('content-disposition', 'attachment; filename=eighty-replay.json');
      return json(res, 200, { version: 2, ruleset: record.game?.ruleset, rules: record.game?.rules, dealing: record.game?.dealing,
        dealIntervalMs: record.config?.dealIntervalMs, events: record.game?.events || [], rounds: record.game?.rounds || [], stats: record.stats, statsDeferred: record.statsDeferred, archives: record.archives });
    }
    if (url.pathname === '/api/audit' && req.method === 'GET') {
      // Do not disclose private bidding work before the current deal finishes.
      const current = session.view(-1);
      if (current.statsDeferred) return json(res, 409, { error: '本局结束后才能导出完整用量记录' });
      res.setHeader('content-disposition', 'attachment; filename=eighty-usage.json');
      return json(res, 200, { entries: context.auditRows, stats: current.stats, archives: current.archives });
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    const allowedSources = ['/src/cards.js', '/src/notebook.js', '/src/rules.js', '/src/training.js', '/src/player-settings.js', '/src/model-catalog.js'];
    let file;
    if (allowedSources.includes(url.pathname)) file = join(root, url.pathname);
    else {
      const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      file = resolve(root, 'public', name);
      if (!file.startsWith(join(root, 'public') + '/')) return json(res, 403, { error: 'Forbidden' });
    }
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
    res.end(content);
  } catch (error) { if (res.headersSent) res.end(); else json(res, error.status || (error.code === 'ENOENT' ? 404 : 400), { error: error.code === 'ENOENT' ? 'Not found' : error.message }); }
});
const port = Number(process.env.PORT || 5173);
server.listen(port, bindHost, () => console.log('80分 ready at http://127.0.0.1:' + server.address().port));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (stopping) return; stopping = true;
  setTimeout(() => process.exit(1), 5000).unref();
  await sessions.stop(); server.close(); server.closeAllConnections(); process.exit(0);
});
