import test from 'node:test';
import assert from 'node:assert/strict';
import { siteEdition, SiteConnections, matchingSecret } from '../server/site-edition.js';
import { browserOriginAllowed } from '../server/request-origin.js';

const profile = { id: 'sponsored-alibaba', name: 'AI on Tony', model: 'fixture-model', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', default: true };
const config = { EIGHTY_SITE_EDITION: '1', EIGHTY_GATEWAY_SECRET: 'fixture-internal-gateway-secret-32-characters', EIGHTY_SPONSOR_GATEWAY: 'https://game.example.com', EIGHTY_SPONSOR_PUBLIC_PROFILES: JSON.stringify([profile]) };
test('public document links work while cross-site API access remains blocked', () => {
  const request = { method: 'GET', pathname: '/', expectedOrigin: 'https://game.example.com', site: 'cross-site', mode: 'navigate', destination: 'document' };
  assert.equal(browserOriginAllowed(request, true), true);
  assert.equal(browserOriginAllowed(request), false, 'upstream defaults are unchanged');
  for (const pathname of ['/api/state','/api/replay','/_eighty/checkpoints/id/read']) assert.equal(browserOriginAllowed({ ...request, pathname }, true), false);
  assert.equal(browserOriginAllowed({ ...request, method: 'POST' }, true), false);
  assert.equal(browserOriginAllowed({ ...request, mode: 'cors' }, true), false);
  assert.equal(browserOriginAllowed({ ...request, origin: 'https://attacker.example' }, true), false);
});
test('the website edition is explicit and ordinary environment keys never opt a table in', () => {
  assert.equal(siteEdition({ QWEN_API_KEY: 'fixture-not-a-real-key' }), null);
  assert.equal(siteEdition({ EIGHTY_SITE_EDITION: '1' }).public.sponsored, false);
  assert.throws(() => siteEdition({ ...config, EIGHTY_GATEWAY_SECRET: '' }), /authenticated gateway/);
  assert.throws(() => siteEdition({ ...config, EIGHTY_SPONSOR_PUBLIC_PROFILES: JSON.stringify([{ ...profile, key: 'fixture-secret' }]) }), /credentials/);
  assert.equal(matchingSecret(config.EIGHTY_GATEWAY_SECRET, config.EIGHTY_GATEWAY_SECRET), true);
  assert.equal(matchingSecret('wrong', config.EIGHTY_GATEWAY_SECRET), false);
  assert.equal(matchingSecret('é'.repeat(48), config.EIGHTY_GATEWAY_SECRET), false);
});
test('sponsored profiles are read-only, credential-free, and excluded from saved connections', () => {
  const edition = siteEdition(config);
  const connections = edition.connectionFactory({ id: 'a'.repeat(64), visitor: 'b'.repeat(64) });
  assert.equal(connections.list()[0].sponsored, true);
  assert.equal(connections.list()[0].default, true);
  assert.equal(connections.status().qwen, true);
  assert.deepEqual(connections.snapshot(), []);
  assert.equal(JSON.stringify(connections.list()).includes(config.EIGHTY_GATEWAY_SECRET), false);
  assert.throws(() => connections.save({ ...profile, key: 'different-fixture-key' }), /cannot be edited/);
  assert.throws(() => connections.remove(profile.id), /cannot be edited/);
  assert.throws(() => connections.forget(profile.id), /cannot be edited/);
  connections.forget();
  assert.equal(connections.list()[0].active, true, 'clearing personal keys cannot disable the host connection');
  assert.throws(() => connections.bind({ kind: 'api', connectionId: profile.id, model: 'unlisted' }), /unavailable/);
  assert.equal(connections.bind({ kind: 'api', connectionId: profile.id, model: profile.model }).provider, 'qwen');
});
test('sponsored game requests keep the existing deadline and use only the authenticated broker', async () => {
  const calls = [];
  const connections = new SiteConnections({ profiles: [profile], gateway: config.EIGHTY_SPONSOR_GATEWAY, secret: config.EIGHTY_GATEWAY_SECRET,
    id: 'a'.repeat(64), visitor: 'b'.repeat(64), gatewayFetch: async (...args) => { calls.push(args); return { ok: true }; } });
  const bound = connections.resolve({ kind: 'api', provider: 'qwen', connectionId: profile.id, model: profile.model });
  assert.equal(bound.env.QWEN_API_KEY, 'eighty-gateway-managed');
  const controller = new AbortController();
  const body = JSON.stringify({ model: profile.model, messages: [{ role: 'user', content: 'Own hand and public information fixture' }] });
  await bound.fetchImpl(profile.baseUrl + '/chat/completions', { method: 'POST', body, signal: controller.signal, headers: { authorization: 'must-not-forward' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://game.example.com/_eighty/sponsored/sponsored-alibaba');
  assert.equal(calls[0][1].signal, controller.signal);
  assert.equal(calls[0][1].headers.authorization, 'Bearer ' + config.EIGHTY_GATEWAY_SECRET);
  assert.equal(calls[0][1].headers['x-eighty-session'], 'a'.repeat(64));
  assert.equal(calls[0][1].body, body);
  await assert.rejects(() => bound.fetchImpl('https://other.example.com/chat/completions', { method: 'POST', body }), /Invalid sponsored/);
  assert.equal(calls.length, 1);
});
