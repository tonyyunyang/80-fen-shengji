import { DurableObject } from 'cloudflare:workers';
import { sponsoredRequest } from './sponsor-core.js';

export class SponsoredAI extends DurableObject {
  async fetch(request) {
    const response = await sponsoredRequest(request, this.env, this.ctx.storage);
    await this.armCleanup();
    return response;
  }
  // Called only through an internal binding, never a public request body.
  // Signed session cookies prevent invented cookie values from bypassing
  // this creation gate. The daily cap also bounds new table/storage growth.
  async admit(visitor) {
    if (!/^[a-f0-9]{64}$/.test(visitor)) return false;
    const now=Date.now(),day=new Date(now).toISOString().slice(0,10),minute=Math.floor(now/60000);
    const maximum=Number(this.env.EIGHTY_TABLES_PER_DAY || 100);
    if (!Number.isSafeInteger(maximum)||maximum<1||maximum>1000) return false;
    const keys=[day+':tables',day+':visitor-tables:'+visitor,day+':minute:'+visitor];
    const allowed=await this.ctx.storage.transaction(async tx=>{
      const old=await tx.get(keys),recent=old.get(keys[2]);
      if ((old.get(keys[0])||0)>=maximum || (old.get(keys[1])||0)>=40 || recent?.minute===minute&&recent.count>=12) return false;
      await tx.put({[keys[0]]:(old.get(keys[0])||0)+1,[keys[1]]:(old.get(keys[1])||0)+1,[keys[2]]:{minute,count:recent?.minute===minute?recent.count+1:1}});
      return true;
    });
    await this.armCleanup();return allowed;
  }
  async armCleanup() {
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now()+86400000);
  }
  async alarm() {
    const before=new Date(Date.now()-2*86400000).toISOString().slice(0,10);
    while (true) {
      const expired=await this.ctx.storage.list({end:before,limit:1000});
      if (!expired.size) break;
      await this.ctx.storage.delete([...expired.keys()]);
    }
    if ((await this.ctx.storage.list({limit:1})).size) await this.ctx.storage.setAlarm(Date.now()+86400000);
  }
}
