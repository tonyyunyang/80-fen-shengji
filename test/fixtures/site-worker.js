// Local-only fixture. The actual gateway/router, Durable Object storage and
// R2 API run in workerd; the model transport always returns synthetic data.
import { DurableObject } from 'cloudflare:workers';
import worker from '../../cloudflare/worker.js';
import { sponsoredRequest } from '../../cloudflare/sponsor-core.js';

export class FixtureSponsoredAI extends DurableObject {
  fetch(request) {
    return sponsoredRequest(request, this.env, this.ctx.storage, async () => Response.json({
      choices: [{ message: { content: 'fixture ' + this.env.SPONSOR_ALIBABA_API_KEY } }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    }));
  }
}
export class FixtureContainer extends DurableObject {
  fetch(request) {
    return Response.json({ host: request.headers.get('host'), origin: request.headers.get('origin'),
      gatewayValid: request.headers.get('x-eighty-gateway') === this.env.EIGHTY_GATEWAY_SECRET,
      visitor: request.headers.get('x-eighty-visitor'), authorization: request.headers.has('authorization') });
  }
}
export default worker;
