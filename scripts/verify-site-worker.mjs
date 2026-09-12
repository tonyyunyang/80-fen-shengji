// Native local Cloudflare integration check. All provider output is a
// fixture; no real key is read and no upstream model endpoint is contacted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = await mkdtemp(join(tmpdir(), 'eighty-worker-check-'));
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const url = 'http://127.0.0.1:' + port;
const secret = 'fixture-gateway-secret-with-more-than-32-characters';
const identity = 'a'.repeat(64), visitor = 'b'.repeat(64);
let child, logs = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function start() {
  logs = '';
  child = spawn(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--config', 'test/fixtures/site-worker.jsonc', '--port', String(port), '--inspector-port', '0', '--persist-to', dir, '--log-level', 'warn'], {
    cwd: root, env: { PATH: process.env.PATH, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Local Worker exited: ' + logs);
    try { if ((await fetch(url + '/_eighty/unknown', { signal: AbortSignal.timeout(500) })).status === 404) return; } catch {}
    await pause(200);
  }
  throw new Error('Local Worker did not start: ' + logs);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited; clearTimeout(timer);
}
const post = (path, body, headers = {}) => fetch(url + path, { method: 'POST', headers: {
  'content-type': 'application/json', authorization: 'Bearer ' + secret,
  'x-eighty-session': identity, 'x-eighty-visitor': visitor, ...headers,
}, body: JSON.stringify(body) });
const modelBody = { model: 'fixture-model', messages: [{ role: 'user', content: 'Synthetic own-hand fixture' }], max_tokens: 512 };
try {
  await start();
  // fetch() writes its own cors mode; use HTTP to supply the metadata a
  // browser's actual top-level navigation sends.
  const forwarded = await new Promise((resolve, reject) => {
    const req = httpRequest(url + '/', { headers: { authorization: 'client-supplied', 'x-eighty-gateway': 'client-supplied', 'x-eighty-visitor': 'client-supplied',
      'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { assert.equal(res.statusCode, 200); resolve(JSON.parse(text)); } catch (error) { reject(error); } });
    }); req.on('error', reject); req.end();
  });
  assert.equal(forwarded.host, 'game.example.com'); assert.equal(forwarded.gatewayValid, true);
  assert.match(forwarded.visitor, /^[a-f0-9]{64}$/); assert.equal(forwarded.authorization, false);
  assert.equal((await fetch(url + '/api/state', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  const path = '/_eighty/sponsored/sponsored-alibaba';
  assert.equal((await post(path, modelBody, { authorization: 'Bearer wrong' })).status, 403);
  const a = await post(path, modelBody);
  assert.equal(a.status, 200); assert.ok((await a.text()).includes('[redacted]'));
  assert.equal((await post(path, modelBody)).status, 200);
  assert.equal((await post(path, modelBody)).status, 429);
  const savePath = '/_eighty/checkpoints/' + identity;
  const checkpoint = { state: { id: 'fixture-saved-table' }, connections: [], auditRows: [] };
  assert.equal((await post(savePath + '/write', checkpoint)).status, 200);
  assert.equal((await post(savePath + '/read', {}, { authorization: 'Bearer wrong' })).status, 403);
  await stop();
  await start();
  assert.deepEqual(await (await post(savePath + '/read', {})).json(), checkpoint);
  assert.equal((await post(path, modelBody)).status, 429, 'restart cannot reset visitor or session allowance');
  const other = { 'x-eighty-session': 'c'.repeat(64), 'x-eighty-visitor': 'd'.repeat(64) };
  assert.equal((await post(path, modelBody, other)).status, 200);
  assert.equal((await post(path, modelBody, other)).status, 429, 'global allowance also survived restart');
  console.log('Native local Worker checks passed: ingress, auth, redaction, persistent quotas, and private R2 restore across restart. No model calls.');
} finally { await stop(); await rm(dir, { recursive: true, force: true }); }
