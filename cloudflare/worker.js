import { Container } from '@cloudflare/containers';
import { DurableObject, env } from 'cloudflare:workers';
import { publicProfiles, secretMatches, sponsoredRequest, visitorIdentity } from './sponsor-core.js';
import { checkpointRequest } from './checkpoints.js';
import { browserOriginAllowed } from '../server/request-origin.js';

export class EightyContainer extends Container {
  defaultPort = 5173;
  sleepAfter = '30m';
  envVars = {
    HOST: '0.0.0.0', PORT: '5173', EIGHTY_SITE_EDITION: '1', EIGHTY_DATA_DIR: '/tmp/eighty-data',
    EIGHTY_PUBLIC_ORIGIN: env.EIGHTY_PUBLIC_ORIGIN,
    EIGHTY_MAX_SESSIONS: '16', EIGHTY_GATEWAY_SECRET: env.EIGHTY_GATEWAY_SECRET,
    EIGHTY_SPONSOR_GATEWAY: env.EIGHTY_PUBLIC_ORIGIN,
    EIGHTY_CHECKPOINTS: 'r2',
    EIGHTY_SPONSOR_PUBLIC_PROFILES: JSON.stringify(publicProfiles(env)),
  };
}
export class SponsoredAI extends DurableObject {
  async fetch(request) {
    const response = await sponsoredRequest(request, this.env, this.ctx.storage);
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now() + 86400000);
    return response;
  }
  async alarm() {
    const before = new Date(Date.now() - 2 * 86400000).toISOString().slice(0,10);
    while (true) {
      const expired = await this.ctx.storage.list({ end: before, limit: 1000 });
      if (!expired.size) break;
      await this.ctx.storage.delete([...expired.keys()]);
    }
    await this.ctx.storage.setAlarm(Date.now() + 86400000);
  }
}
export default {
  async fetch(request, bindings) {
    const url = new URL(request.url);
    const secret = bindings.EIGHTY_GATEWAY_SECRET;
    if (!secret || secret.length < 32) return new Response('Website edition is not configured.', { status: 503 });
    if (url.pathname.startsWith('/_eighty/sponsored/')) {
      if (!await secretMatches(request.headers.get('authorization'), secret)) return new Response('Forbidden', { status: 403 });
      return bindings.SPONSORED_AI.getByName('daily-allowance').fetch(request);
    }
    if (url.pathname.startsWith('/_eighty/checkpoints/')) return checkpointRequest(request, bindings);
    if (url.pathname.startsWith('/_eighty/')) return new Response('Not found', { status: 404 });
    const suppliedOrigin = request.headers.get('origin');
    if (!browserOriginAllowed({ method: request.method, pathname: url.pathname, origin: suppliedOrigin, expectedOrigin: url.origin,
      site: request.headers.get('sec-fetch-site'), mode: request.headers.get('sec-fetch-mode'), destination: request.headers.get('sec-fetch-dest') }, true)) return new Response('Forbidden', { status: 403 });
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    headers.set('host', new URL(bindings.EIGHTY_PUBLIC_ORIGIN).host);
    if (suppliedOrigin) headers.set('origin', bindings.EIGHTY_PUBLIC_ORIGIN);
    headers.set('x-eighty-gateway', secret);
    headers.set('x-eighty-visitor', await visitorIdentity(request.headers.get('cf-connecting-ip') || 'local-development', secret));
    // One named container preserves cookie-to-table affinity. Random load
    // balancing would split the existing in-memory sessions between servers.
    const containerUrl = new URL(bindings.EIGHTY_PUBLIC_ORIGIN);
    containerUrl.pathname = url.pathname; containerUrl.search = url.search;
    return bindings.EIGHTY_CONTAINER.getByName('website-tables').fetch(new Request(containerUrl, new Request(request, { headers })));
  },
};
