import { browserOriginAllowed } from '../server/request-origin.js';
import { visitorIdentity } from './sponsor-core.js';
import { mintSession,readSession,cookieName,cookieHeader } from './session-cookie.js';
export { GameTable } from './game-table.js';
export { SponsoredAI } from './sponsored-object.js';

const json=(status,data)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export default {
  async fetch(request,env){
    const url=new URL(request.url),local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(!local&&url.protocol!=='https:'){url.protocol='https:';return Response.redirect(url.href,308);}
    if(url.pathname.startsWith('/_eighty/'))return json(404,{error:'Not found'});
    if(!url.pathname.startsWith('/api/')){
      const asset=await env.ASSETS.fetch(request);
      const result=new Response(asset.body,asset);
      const socketOrigin=url.origin.replace(/^http/,'ws');
      result.headers.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' "+socketOrigin+"; base-uri 'none'; frame-ancestors 'none'");
      result.headers.set('x-content-type-options','nosniff');result.headers.set('referrer-policy','no-referrer');
      return result;
    }
    if(!browserOriginAllowed({method:request.method,pathname:url.pathname,origin:request.headers.get('origin'),expectedOrigin:url.origin,
      site:request.headers.get('sec-fetch-site'),mode:request.headers.get('sec-fetch-mode'),destination:request.headers.get('sec-fetch-dest')}))return json(403,{error:'Origin rejected'});
    if(url.pathname==='/api/health'&&request.method==='GET')return json(200,{ready:true,hosting:'workers-free'});
    const secret=env.EIGHTY_GATEWAY_SECRET;
    if(typeof secret!=='string'||secret.length<32)return json(503,{error:'Configure the private session secret'});
    const raw=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName(url)+'='))?.slice(cookieName(url).length+1);
    let session=await readSession(raw,secret,Date.now(),url.origin),setCookie=null;
    const visitor=await visitorIdentity(request.headers.get('cf-connecting-ip')||'local-development',secret);
    if(!session){
      if(request.method!=='GET'||url.pathname!=='/api/state')return json(401,{error:'会话已过期，请刷新页面'});
      try{if(!await env.SPONSORED_AI.getByName('session-admission').admit(visitor))return json(429,{error:'创建牌桌过于频繁，请稍后重试'});}
      catch{return json(503,{error:'免费牌桌额度暂时不可用，请稍后重试'});}
      const minted=await mintSession(secret,Date.now(),url.origin);session=minted.id;setCookie=cookieHeader(url,minted.value);
    }
    const headers=new Headers(request.headers);
    headers.delete('authorization');headers.delete('cookie');
    headers.set('x-eighty-gateway',secret);headers.set('x-eighty-session',session);headers.set('x-eighty-visitor',visitor);
    const result=await env.GAME_TABLES.getByName(session).fetch(new Request(request,{headers}));
    if(!setCookie)return result;
    const withCookie=new Response(result.body,result);withCookie.headers.set('set-cookie',setCookie);return withCookie;
  },
};
