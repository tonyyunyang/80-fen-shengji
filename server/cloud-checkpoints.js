import { safeProviderFetch } from './safe-network.js';

// Checkpoints are already stripped of connection keys by BrowserSessions.
// The authenticated Worker stores them in a private R2 bucket, so container
// sleep/redeploy does not destroy a visitor's saved table.
export class CloudCheckpoints {
  constructor({ gateway, secret, fetchImpl = safeProviderFetch() }) {
    this.gateway = gateway; this.secret = secret; this.fetchImpl = fetchImpl;
  }
  async request(id, action, body) {
    if (!/^[a-f0-9]{64}$/.test(id) || Buffer.byteLength(body) > 1048576) throw new Error('Invalid checkpoint');
    return this.fetchImpl(this.gateway + '/_eighty/checkpoints/' + id + '/' + action, {
      method: 'POST', body, signal: AbortSignal.timeout(5000),
      headers: { authorization: 'Bearer ' + this.secret, 'content-type': 'application/json' },
    });
  }
  async read(id) {
    const response = await this.request(id, 'read', '{}');
    if (response.status === 404) return null;
    if (!response.ok) throw Object.assign(new Error('Saved table is temporarily unavailable'), { status: 503 });
    return response.json();
  }
  async write(id, content) {
    const response = await this.request(id, 'write', content);
    if (!response.ok) throw new Error('Could not save the table');
  }
}
