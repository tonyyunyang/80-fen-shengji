import { secretMatches, boundedText } from './sponsor-core.js';

export async function checkpointRequest(request, env, now = Date.now()) {
  const json = (status, value) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  if (!await secretMatches(request.headers.get('authorization'), env.EIGHTY_GATEWAY_SECRET)) return json(403, { error: 'Forbidden' });
  const match = new URL(request.url).pathname.match(/^\/_eighty\/checkpoints\/([a-f0-9]{64})\/(read|write)$/);
  if (!match || request.method !== 'POST') return json(400, { error: 'Invalid checkpoint request' });
  if (!env.EIGHTY_SAVES) return json(503, { error: 'Checkpoint storage is unavailable' });
  const [, id, action] = match, key = 'sessions/' + id + '.json';
  try {
    if (action === 'read') {
      const object = await env.EIGHTY_SAVES.get(key);
      if (!object) return json(404, { error: 'Not found' });
      if (Number(object.customMetadata?.expires || 0) <= now) { await env.EIGHTY_SAVES.delete(key); return json(404, { error: 'Expired' }); }
      if (object.size > 1048576) return json(503, { error: 'Checkpoint is too large' });
      return new Response(object.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    const content = await boundedText(request.body, 1048576);
    const data = JSON.parse(content);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return json(400, { error: 'Invalid checkpoint' });
    await env.EIGHTY_SAVES.put(key, content, { httpMetadata: { contentType: 'application/json' }, customMetadata: { expires: String(now + 7 * 86400000) } });
    return json(200, { ok: true });
  } catch { return json(503, { error: 'Checkpoint storage is temporarily unavailable' }); }
}
