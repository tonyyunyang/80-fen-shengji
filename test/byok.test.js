import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Connections } from '../server/connections.js';
import { BrowserSessions } from '../server/browser-sessions.js';
import { publicAddress, providerUrl, safeProviderFetch } from '../server/safe-network.js';
import { Session } from '../server/session.js';
import { requestAction } from '../src/providers.js';
import { createGame, observation, safeAction } from '../src/game.js';

const secret = 'fixture-key-that-is-not-a-credential';
const profile = { name: 'Fixture gateway', provider: 'qwen', baseUrl: 'https://example.com/v1', models: [{ id: 'fixture-model', input: 1, output: 2 }] };
const game = () => createGame({ seed: 21, seats: Array.from({ length: 4 }, () => ({ kind: 'peilian' })) });

test('CSRF rejects malformed byte lengths with an authorization error', () => {
  const context = { csrf: 'a'.repeat(64), mutations: [] };
  const authorize = supplied => BrowserSessions.prototype.authorize(context, { headers: { 'x-eighty-csrf': supplied } });
  for (const supplied of [undefined, ['a'.repeat(64)], 'b'.repeat(64), 'é'.repeat(64), 'é'.repeat(32)]) {
    assert.throws(() => authorize(supplied), error => error.status === 403);
  }
  assert.deepEqual(context.mutations, [], 'rejected tokens never enter the authorized mutation budget');
  authorize(context.csrf);
  assert.equal(context.mutations.length, 1);
});

test('connections keep keys out of lists/checkpoints and require re-entry for a changed destination', () => {
  const a = new Connections(), b = new Connections();
  const id = a.save({ ...profile, key: secret });
  const seat = { kind: 'api', provider: 'qwen', connectionId: id, model: 'fixture-model' };
  assert.equal(a.resolve(seat).env.QWEN_API_KEY, secret);
  assert.equal(b.resolve(seat).env.QWEN_API_KEY, undefined);
  assert.equal(JSON.stringify(a.list()).includes(secret), false);
  const restored = new Connections({ saved: a.snapshot() });
  assert.equal(restored.list().find(p => p.id === id).active, false);
  assert.equal(restored.list().find(p => p.id === id).models[0].id, 'fixture-model');
  a.save({ ...profile, id, baseUrl: 'https://other.example.com/v1' });
  assert.equal(a.resolve(seat).env.QWEN_API_KEY, undefined);
  a.save({ ...profile, id, key: secret }); a.forget();
  assert.equal(a.resolve(seat).env.QWEN_API_KEY, undefined);
  assert.throws(() => a.save({ ...profile, baseUrl: 'https://example.com/v1?key=' + secret, key: secret }));
  assert.throws(() => a.save({ ...profile, name: secret, key: secret }));
});

test('public endpoint validation rejects private, mapped, reserved and disguised addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.1.2', '192.168.1.1', '169.254.169.254', '100.64.1.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '64:ff9b::7f00:1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  for (const url of ['https://127.1/v1', 'https://2130706433/v1', 'https://[::ffff:127.0.0.1]/v1', 'file:///etc/passwd', 'http://example.com/v1', 'https://user:password@example.com/v1', 'https://example.com/v1?secret=x', 'https://metadata.google.internal']) assert.throws(() => providerUrl(url), url);
});

test('DNS results are pinned into the actual request and a rebound private result never reaches transport', async () => {
  let calls = 0, resolutions = 0;
  const transport = (_url, options, onResponse) => {
    calls++; const req = new EventEmitter();
    options.lookup('example.com', {}, (error, address) => { assert.equal(error, null); assert.equal(address, '8.8.8.8'); });
    req.setTimeout = () => {}; req.destroy = () => {};
    req.end = () => { const res = new PassThrough(); res.statusCode = 200; res.headers = {}; onResponse(res); res.end('{}'); };
    return req;
  };
  const fetch = safeProviderFetch({ resolve: async () => [{ address: ++resolutions === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }], transports: { 'https:': transport } });
  assert.equal((await fetch('https://example.com/v1', { method: 'POST', body: '{}', headers: {} })).ok, true);
  await assert.rejects(fetch('https://example.com/v1', { method: 'POST', body: '{}', headers: {} }), /私有/);
  assert.equal(calls, 1);
});

test('real local fixture transport strips echoed keys from metadata and never follows redirects', async () => {
  let destinationCalls = 0, receivedAuth;
  const fixture = http.createServer(async (req, res) => {
    if (req.url === '/redirect/chat/completions') { res.writeHead(302, { location: '/destination' }); res.end(); return; }
    if (req.url === '/destination') destinationCalls++;
    let body = ''; for await (const chunk of req) body += chunk;
    receivedAuth = req.headers.authorization;
    const request = JSON.parse(body);
    res.setHeader('content-type', 'application/json'); res.setHeader('x-request-id', secret);
    res.end(JSON.stringify({ id: secret, model: secret, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: request.tools[0].function.name, arguments: JSON.stringify({ choice: 'pass' }) } }] } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 }, echo: secret } }));
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  try {
    const connections = new Connections({ allowLoopback: true });
    const id = connections.save({ ...profile, baseUrl: 'http://127.0.0.1:' + fixture.address().port + '/v1', key: secret });
    const seat = { kind: 'api', provider: 'qwen', connectionId: id, model: 'fixture-model' };
    const state = game(), view = observation(state, state.pending.seat);
    const result = await requestAction(view, seat, connections.resolve(seat));
    assert.equal(receivedAuth, 'Bearer ' + secret);
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(result.usage.input, 5);
    assert.equal(result.metering.referenceCost.amount, .000009);
    connections.save({ ...profile, id, baseUrl: 'http://127.0.0.1:' + fixture.address().port + '/redirect', key: secret });
    await assert.rejects(requestAction(view, seat, connections.resolve(seat)), error => error.metering.httpStatus === 302);
    assert.equal(destinationCalls, 0);
  } finally { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
});

test('browser sessions persist only safe metadata, expire keys and isolate hosted loopback permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eighty-byok-'));
  const sessions = new BrowserSessions({ directory, hosted: true, allowLoopback: true, idleMs: 1 });
  let cookieHeader;
  const req = { headers: { host: 'game.example.com' }, socket: { remoteAddress: 'test' } };
  try {
    const context = await sessions.get(req, { setHeader: (_, value) => cookieHeader = value }, true);
    assert.match(cookieHeader, /^__Host-eighty=/); assert.match(cookieHeader, /Secure/);
    assert.throws(() => context.connections.save({ ...profile, baseUrl: 'http://127.0.0.1/v1', key: secret }));
    const id = context.connections.save({ ...profile, key: secret });
    context.connections.fetchImpl = async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({
      id: secret, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'declare_trump', arguments: '{"choice":"pass"}' } }] } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, echo: secret },
    }) });
    context.session.start({ dealing: 'ordered', speed: 2000, seats: Array.from({ length: 4 }, () => ({ kind: 'api', provider: 'qwen', connectionId: id, model: 'fixture-model' })) });
    await context.session.step(); context.session.pause(true); await context.writes;
    assert.ok(context.auditRows.length >= 2);
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.equal((await readFile(join(directory, files[0]), 'utf8')).includes(secret), false);
    assert.equal((await readFile(join(directory, files[0]), 'utf8')).includes(context.csrf), false);
    context.lastSeen = 0; await sessions.sweep();
    assert.equal(context.connections.keys.size, 0); assert.equal(sessions.entries.size, 0);
  } finally { await sessions.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('restart preserves late usage on the old table while rejecting its late action', async () => {
  let release;
  const session = new Session({ env: { QWEN_API_KEY: secret, QWEN_BASE_URL: 'https://example.com/v1' },
    providerCall: view => new Promise(resolve => release = () => resolve({ action: safeAction(view), usage: { input: 31, output: 4, cached: 0, cacheWrite: 0 }, usageKnown: true, simulated: false, ms: 100 })) });
  session.start({ dealing: 'ordered', seats: Array.from({ length: 4 }, () => ({ kind: 'api', provider: 'qwen', model: 'fixture-model' })), rules: { gates: false }, speed: 2000 });
  try {
    const old = session.state.id, pending = session.step();
    session.restart(); await pending;
    release(); for (let i = 0; i < 15; i++) await Promise.resolve();
    assert.notEqual(session.state.id, old); assert.deepEqual(session.config.rules.gates, []);
    assert.equal(session.stats.input, 0); assert.equal(session.archives[0].stats.input, 31);
    assert.equal(session.archives[0].stats.usageUnknown, 0);
  } finally { session.stop(); }
});
