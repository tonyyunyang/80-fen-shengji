import { timingSafeEqual } from 'node:crypto';
import { Connections } from './connections.js';
import { safeProviderFetch, providerUrl } from './safe-network.js';
import { CloudCheckpoints } from './cloud-checkpoints.js';

const managedId = /^sponsored-[a-z0-9-]{1,40}$/;
const text = value => typeof value === 'string' && value.length > 0;
export function matchingSecret(actual, expected) {
  if (!text(actual) || !text(expected)) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Explicit website-edition configuration. Ordinary upstream launches retain
// their BYOK-only behavior and never load a credential file.
export function siteEdition(env = {}) {
  if (env.EIGHTY_SITE_EDITION !== '1') return null;
  const gateway = env.EIGHTY_SPONSOR_GATEWAY || '';
  const secret = env.EIGHTY_GATEWAY_SECRET || '';
  const profiles = JSON.parse(env.EIGHTY_SPONSOR_PUBLIC_PROFILES || '[]');
  if (!Array.isArray(profiles) || profiles.length > 4) throw new Error('Invalid sponsored profile configuration');
  const seen = new Set();
  for (const p of profiles) {
    if (!managedId.test(p.id) || seen.has(p.id) || !text(p.name) || p.name.length > 50 || !text(p.model) || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(p.model)) throw new Error('Invalid sponsored profile');
    providerUrl(p.baseUrl);
    if (p.key !== undefined || p.apiKey !== undefined) throw new Error('Public profiles must not contain credentials');
    seen.add(p.id);
  }
  if (profiles.length && (secret.length < 32 || !gateway)) throw new Error('Sponsored AI requires an authenticated gateway');
  if (secret.length >= 32 && JSON.stringify(profiles).includes(secret)) throw new Error('Keep gateway credentials out of public profiles');
  if (gateway) providerUrl(gateway);
  if (env.EIGHTY_CHECKPOINTS === 'r2' && (!gateway || secret.length < 32)) throw new Error('Cloud checkpoints require an authenticated gateway');
  return {
    secret,
    public: { name: 'Tony’s website edition', branch: 'codex/tonytheyang-site', repository: 'https://github.com/tonyyunyang/80-fen-shengji', sponsored: profiles.length > 0 },
    connectionFactory: options => new SiteConnections({ ...options, gateway, secret, profiles }),
    checkpoints: env.EIGHTY_CHECKPOINTS === 'r2' ? new CloudCheckpoints({ gateway, secret }) : undefined,
  };
}

export class SiteConnections extends Connections {
  constructor({ profiles = [], gateway = '', secret = '', id, visitor, gatewayFetch, ...options } = {}) {
    super(options);
    this.managed = new Map(profiles.map(p => [p.id, { id: p.id, name: p.name, provider: 'qwen', baseUrl: p.baseUrl,
      models: [{ id: p.model, label: p.label || p.model, input: null, output: null }], active: true, sponsored: true, default: p.default === true }]));
    this.gateway = gateway; this.gatewaySecret = secret; this.sessionId = id; this.visitor = visitor;
    this.gatewayFetch = gatewayFetch || safeProviderFetch();
  }
  list() { return [...this.managed.values()].map(p => structuredClone(p)).concat(super.list()); }
  status() { return { ...super.status(), qwen: this.managed.size > 0 || super.status().qwen }; }
  guard(id) { if (managedId.test(id || '')) throw new Error('This connection is provided by Tony and cannot be edited'); }
  save(input) { this.guard(input?.id); return super.save(input); }
  discover(input) { this.guard(input?.id); return super.discover(input); }
  remove(id) { this.guard(id); return super.remove(id); }
  forget(id) { this.guard(id); return super.forget(id); }
  bind(seat) {
    if (!managedId.test(seat.connectionId || '')) return super.bind(seat);
    const profile = this.managed.get(seat.connectionId);
    if (seat.kind !== 'api' || !profile?.models.some(m => m.id === seat.model)) throw new Error('Sponsored model is unavailable');
    return { ...seat, provider: 'qwen' };
  }
  resolve(seat) {
    if (!managedId.test(seat.connectionId || '')) return super.resolve(seat);
    const profile = this.managed.get(seat.connectionId);
    if (!profile || seat.provider !== 'qwen' || !profile.models.some(m => m.id === seat.model)) return { env: {} };
    return {
      // The upstream provider key exists only in the Cloudflare broker.
      env: { QWEN_API_KEY: 'eighty-gateway-managed', QWEN_BASE_URL: profile.baseUrl },
      allowCustomModel: true,
      referencePrice: null,
      fetchImpl: async (url, options) => {
        if (url !== profile.baseUrl + '/chat/completions' || options.method !== 'POST' || typeof options.body !== 'string' || Buffer.byteLength(options.body) > 65536) throw new Error('Invalid sponsored request');
        if (!/^[a-f0-9]{64}$/.test(this.sessionId || '') || !/^[a-f0-9]{64}$/.test(this.visitor || '')) throw new Error('Sponsored session identity unavailable');
        return this.gatewayFetch(this.gateway + '/_eighty/sponsored/' + profile.id, {
          method: 'POST', signal: options.signal, body: options.body,
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.gatewaySecret,
            'x-eighty-session': this.sessionId, 'x-eighty-visitor': this.visitor },
        });
      },
    };
  }
}
