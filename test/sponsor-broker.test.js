import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, publicProfiles, reserve, sponsoredRequest, visitorIdentity } from '../cloudflare/sponsor-core.js';

const secret = 'fixture-gateway-secret-with-more-than-32-characters';
const key = 'fixture-provider-key-not-a-live-credential';
const profile = { id: 'sponsored-alibaba', name: 'AI on Tony', model: 'fixture-model', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keySecret: 'SPONSOR_ALIBABA_API_KEY', default: true };
const env = { EIGHTY_GATEWAY_SECRET: secret, SPONSORED_ENABLED: 'true', SPONSOR_PROFILES: JSON.stringify([profile]), SPONSOR_ALIBABA_API_KEY: key,
  SPONSOR_DAILY_REQUESTS: '3', SPONSOR_SESSION_REQUESTS: '2', SPONSOR_VISITOR_REQUESTS: '2', SPONSOR_MAX_OUTPUT_TOKENS: '512' };
function memoryStorage() {
  const data = new Map(); let pending = Promise.resolve();
  return { data, transaction(fn) {
    const job = pending.then(() => fn({ get: async keys => new Map(keys.filter(k => data.has(k)).map(k => [k,data.get(k)])), put: async values => Object.entries(values).forEach(([k,v])=>data.set(k,v)) }));
    pending = job.catch(() => {}); return job;
  } };
}
const body = { model: profile.model, messages: [{ role: 'system', content: 'Synthetic game fixture' }, { role: 'user', content: 'Own hand only' }], max_tokens: 1000 };
function request({ session = 'a'.repeat(64), visitor = 'b'.repeat(64), payload = body, authorization = 'Bearer ' + secret } = {}) {
  return new Request('https://game.example.com/_eighty/sponsored/' + profile.id, { method: 'POST', headers: {
    'content-type': 'application/json', authorization, 'x-eighty-session': session, 'x-eighty-visitor': visitor,
  }, body: JSON.stringify(payload) });
}
test('sponsorship is disabled by default and only ordinary API endpoints are accepted', () => {
  assert.deepEqual(profiles({}), []);
  assert.throws(() => profiles({ ...env, SPONSOR_DAILY_REQUESTS: '0' }), /explicitly configured/);
  for (const baseUrl of ['https://coding.dashscope.aliyuncs.com/v1', 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', 'https://api.kimi.com/coding/v1', 'https://private.example.com/v1']) {
    assert.throws(() => profiles({ ...env, SPONSOR_PROFILES: JSON.stringify([{ ...profile, baseUrl }]) }), /standard API/);
  }
  assert.equal(JSON.stringify(publicProfiles(env)).includes(key), false);
  assert.equal('keySecret' in publicProfiles(env)[0], false);
  assert.throws(() => profiles({ ...env, SPONSOR_PROFILES: JSON.stringify([{ ...profile, name: key }]) }), /credentials/);
});
test('durable daily quota is atomic across concurrent requests and survives handler recreation', async () => {
  const storage = memoryStorage(), caps = { global: 3, session: 3, visitor: 3 }, now = Date.UTC(2026,8,11);
  const results = await Promise.all(Array.from({length:12}, () => reserve(storage,caps,'session','visitor',now)));
  assert.equal(results.filter(Boolean).length,3);
  assert.equal(await reserve(storage,caps,'another-session','another-visitor',now),false,'global allowance spans visitors');
  assert.equal(await reserve(storage,caps,'session','visitor',now+86400000),true,'new UTC day starts a fresh allowance');
});
test('per-visitor allowance cannot be reset by creating another browser session', async () => {
  const storage = memoryStorage(), caps = { global: 10, session: 10, visitor: 1 };
  assert.equal(await reserve(storage,caps,'first-cookie','same-visitor'),true);
  assert.equal(await reserve(storage,caps,'new-cookie','same-visitor'),false);
  assert.equal(await reserve(storage,caps,'another-cookie','different-visitor'),true);
});
test('unauthenticated, malformed, unlisted and oversized requests never call a provider', async () => {
  const storage = memoryStorage(); let calls = 0;
  const upstream = async () => { calls++; return Response.json({}); };
  for (const req of [request({ authorization:'Bearer wrong' }), request({ session:'chosen-session' }), request({ payload:{...body,model:'unlisted'} }), request({ payload:{...body,messages:[{role:'user',content:'x'.repeat(70000)}]} })]) {
    assert.ok((await sponsoredRequest(req,env,storage,upstream)).status>=400);
  }
  assert.equal(calls,0); assert.equal(storage.data.size,0);
});
test('the broker caps tokens, strips extra fields, preserves usage and redacts echoed credentials', async () => {
  const storage=memoryStorage(); let seen;
  const response=await sponsoredRequest(request({payload:{...body,n:20,stream:true,base_url:'https://attacker.example'}}),env,storage,async(url,options)=>{
    seen={url,options};return Response.json({choices:[{message:{content:'provider echo '+key}}],usage:{prompt_tokens:10,completion_tokens:5}});
  });
  assert.equal(response.status,200);
  const payload=JSON.parse(seen.options.body);
  assert.equal(payload.max_tokens,512);assert.equal(payload.n,1);assert.equal(payload.stream,false);assert.equal(payload.base_url,undefined);
  assert.equal(seen.options.redirect,'manual');assert.equal(seen.options.headers.authorization,'Bearer '+key);
  const text=await response.text();assert.equal(text.includes(key),false);assert.ok(text.includes('[redacted]'));assert.ok(text.includes('prompt_tokens'));
});
test('quota and quota-store failures fail closed; failed upstream attempts still consume allowance', async () => {
  const storage=memoryStorage();let calls=0;
  const failed=async()=>{calls++;return new Response('redirect',{status:302,headers:{location:'https://attacker.example'}});};
  assert.equal((await sponsoredRequest(request(),env,storage,failed)).status,502);
  assert.equal((await sponsoredRequest(request(),env,storage,failed)).status,502);
  assert.equal((await sponsoredRequest(request(),env,storage,failed)).status,429);
  assert.equal(calls,2);
  assert.equal((await sponsoredRequest(request(),env,{transaction:async()=>{throw new Error('unavailable');}},failed)).status,503);
  assert.equal(calls,2);
});
test('visitor identity is deterministic, salted and not a raw IP address', async () => {
  const a=await visitorIdentity('203.0.113.7',secret);
  assert.match(a,/^[a-f0-9]{64}$/);
  assert.equal(a,await visitorIdentity('203.0.113.7',secret));
  assert.notEqual(a,await visitorIdentity('203.0.113.7','different-secret'));
});
