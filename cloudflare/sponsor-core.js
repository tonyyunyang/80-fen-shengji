const ENDPOINTS = new Set([
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
  'https://api.moonshot.ai/v1',
  'https://api.moonshot.cn/v1',
  // Supported plan endpoints for this operator-authorized deployment.
  // Keep exact endpoint pinning; entitlement is handled with the provider.
  'https://coding.dashscope.aliyuncs.com/v1',
  'https://coding-intl.dashscope.aliyuncs.com/v1',
  'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  'https://api.kimi.com/coding/v1',
]);
const KEY_NAMES = new Set(['SPONSOR_ALIBABA_API_KEY', 'SPONSOR_KIMI_API_KEY']);
const idPattern = /^sponsored-[a-z0-9-]{1,40}$/;
const identityPattern = /^[a-f0-9]{64}$/;
const reply = (status, data, headers = {}) => Response.json(data, { status, headers: { 'cache-control': 'no-store', ...headers } });
function redact(value,secrets){
  if(typeof value==='string'){for(const secret of secrets)value=value.split(secret).join('[redacted]');return value;}
  if(Array.isArray(value))return value.map(item=>redact(item,secrets));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[redact(key,secrets),redact(item,secrets)]));
  return value;
}

export function limits(env) {
  const positive = (name, max) => {
    const n = Number(env[name]);
    if (!Number.isSafeInteger(n) || n <= 0 || n > max) throw new Error('Sponsored limits must be explicitly configured');
    return n;
  };
  return { global: positive('SPONSOR_DAILY_REQUESTS', 100000), session: positive('SPONSOR_SESSION_REQUESTS', 10000),
    visitor: positive('SPONSOR_VISITOR_REQUESTS', 10000), output: positive('SPONSOR_MAX_OUTPUT_TOKENS', 2048) };
}
export function profiles(env) {
  if (env.SPONSORED_ENABLED !== 'true') return [];
  limits(env);
  let raw;
  try { raw = JSON.parse(env.SPONSOR_PROFILES || '[]'); }
  catch { throw new Error('Invalid sponsored profile JSON'); }
  if (!Array.isArray(raw) || !raw.length || raw.length > 4) throw new Error('Configure one to four sponsored profiles');
  const seen = new Set();
  for (const p of raw) {
    if (!idPattern.test(p.id) || seen.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 50 ||
      typeof p.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(p.model) ||
      !ENDPOINTS.has(p.baseUrl) || !KEY_NAMES.has(p.keySecret) || typeof env[p.keySecret] !== 'string' || env[p.keySecret].length < 8) {
      throw new Error('Invalid sponsored configuration: use an approved endpoint and a Worker secret');
    }
    seen.add(p.id);
  }
  for (const key of [...KEY_NAMES, 'EIGHTY_GATEWAY_SECRET']) if (env[key] && JSON.stringify(raw).includes(env[key])) throw new Error('Keep credentials out of public profile metadata');
  if (raw.filter(p => p.default === true).length > 1) throw new Error('Choose at most one default sponsored model');
  return raw;
}
export function publicProfiles(env) {
  return profiles(env).map(({ id, name, model, label, baseUrl, default: isDefault }) => ({ id, name, model, label, baseUrl, default: isDefault === true }));
}
export async function secretMatches(header, secret) {
  if (!secret || secret.length < 32 || typeof header !== 'string') return false;
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a,b] = await Promise.all([digest(header), digest('Bearer ' + secret)]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b); let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
export async function visitorIdentity(address, secret) {
  const data = new TextEncoder().encode('eighty-visitor\0' + secret + '\0' + address);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash].map(n => n.toString(16).padStart(2,'0')).join('');
}
export async function boundedText(body, maximum) {
  if (!body) return '';
  const reader = body.getReader(); const parts = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error('Body too large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size); let at = 0;
  for (const part of parts) { all.set(part, at); at += part.byteLength; }
  return new TextDecoder().decode(all);
}
export async function reserve(storage, caps, session, visitor, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0,10);
  const keys = [day + ':global', day + ':session:' + session, day + ':visitor:' + visitor];
  const maximums = [caps.global, caps.session, caps.visitor];
  return storage.transaction(async tx => {
    const counts = await tx.get(keys);
    if (keys.some((key,i) => (counts.get(key) || 0) >= maximums[i])) return false;
    const updated = Object.fromEntries(keys.map(key => [key, (counts.get(key) || 0) + 1]));
    await tx.put(updated);
    return true;
  });
}
export async function sponsoredRequest(request, env, storage, fetchImpl = fetch, now = Date.now()) {
  if (!await secretMatches(request.headers.get('authorization'), env.EIGHTY_GATEWAY_SECRET)) return reply(403, { error: { message: 'Gateway rejected' } });
  if (request.method !== 'POST') return reply(405, { error: { message: 'POST required' } });
  let enabled, caps;
  try { enabled = profiles(env); caps = limits(env); } catch { return reply(503, { error: { message: 'Sponsored AI is not configured' } }); }
  const id = new URL(request.url).pathname.split('/').at(-1);
  const profile = enabled.find(p => p.id === id);
  if (!profile) return reply(503, { error: { message: 'Sponsored AI unavailable' } });
  const session = request.headers.get('x-eighty-session'), visitor = request.headers.get('x-eighty-visitor');
  if (!identityPattern.test(session || '') || !identityPattern.test(visitor || '')) return reply(400, { error: { message: 'Invalid session identity' } });
  let input;
  try { input = JSON.parse(await boundedText(request.body, 65536)); } catch { return reply(400, { error: { message: 'Invalid request body' } }); }
  if (input.model !== profile.model || !Array.isArray(input.messages) || !input.messages.length || input.messages.length > 12 ||
    input.messages.some(m => !['system','user','assistant','tool'].includes(m.role) || typeof m.content !== 'string')) {
    return reply(400, { error: { message: 'Invalid game request' } });
  }
  const requested = Number(input.max_completion_tokens ?? input.max_tokens ?? caps.output);
  if (!Number.isSafeInteger(requested) || requested <= 0) return reply(400, { error: { message: 'Invalid output limit' } });
  const fields = ['model','messages','tools','tool_choice','parallel_tool_calls','enable_thinking','preserve_thinking','thinking_budget','reasoning_effort','thinking','response_format','temperature','tool_stream','clear_thinking'];
  const payload = Object.fromEntries(fields.filter(k => input[k] !== undefined).map(k => [k,input[k]]));
  payload.stream = false; payload.n = 1;
  payload[input.max_completion_tokens !== undefined ? 'max_completion_tokens' : 'max_tokens'] = Math.min(requested, caps.output);
  if (typeof payload.thinking_budget === 'number') payload.thinking_budget = Math.min(payload.thinking_budget, Math.max(0,caps.output - 128));
  try {
    if (!await reserve(storage, caps, session, visitor, now)) return reply(429, { error: { message: 'Sponsored allowance reached; local practice bots remain available' } });
  } catch { return reply(503, { error: { message: 'Allowance check unavailable' } }); }
  // Every attempted upstream call consumes a reservation, including failures
  // and repairs. Restarts cannot reset this durable, global daily counter.
  const controller = new AbortController();
  const abort = () => controller.abort(); request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) controller.abort();
  const timer = setTimeout(abort, 11000);
  try {
    const upstream = await fetchImpl(profile.baseUrl + '/chat/completions', { method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env[profile.keySecret], 'user-agent': 'Eighty-Website/0.3.0 (tonytheyang.com)' }, body: JSON.stringify(payload) });
    const diagnostic = kind => ({ 'x-eighty-provider-status': String(upstream.status), 'x-eighty-provider-result': kind });
    if (upstream.status >= 300 && upstream.status < 400) return reply(502, { error: { message: 'Provider redirect rejected' } }, diagnostic('redirect'));
    const raw = await boundedText(upstream.body, 1048576);
    // Redact after JSON decoding, so escaped Unicode cannot conceal an
    // echoed key inside provider IDs, errors, usage metadata or tool content.
    let data;
    try { data = redact(JSON.parse(raw), [...KEY_NAMES].map(key=>env[key]).filter(Boolean)); }
    catch {
      // Gateways may return an HTML error. Keep only its status and a numeric
      // Cloudflare error code; neither raw HTML nor provider headers are logged.
      const code = raw.match(/error code:\s*(1\d{3})\b/i)?.[1];
      return reply(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
        { error: { message: 'Sponsored provider returned an unexpected response' } },
        { ...diagnostic('non-json'), ...(code ? { 'x-eighty-provider-code': code } : {}) });
    }
    if (!upstream.ok) return reply(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      { error: { message: 'Sponsored provider request failed' }, ...(data.usage ? { usage: data.usage } : {}) }, diagnostic('http-error'));
    return reply(200, data);
  } catch (error) {
    const code = String(error?.message || '').match(/(?:error\s+code\s*[:=]?\s*|Cloudflare error\s*)(1\d{3})\b/i)?.[1];
    return reply(502, { error: { message: 'Sponsored provider unavailable' } }, {
      'x-eighty-provider-result': controller.signal.aborted ? 'timeout' : 'transport',
      ...(code ? { 'x-eighty-provider-code': code } : {}),
    });
  }
  finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort); }
}
