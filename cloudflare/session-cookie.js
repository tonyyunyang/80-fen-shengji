const encoder=new TextEncoder();
export const SESSION_TTL=7*86400000;
const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const equal=(a,b)=>{if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
async function signature(payload,secret,scope){
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode('eighty-session-v1:'+scope+':'+payload))));
}
export async function mintSession(secret,now=Date.now(),scope='eighty'){
  if(typeof secret!=='string'||secret.length<32)throw new Error('Configure a private session secret');
  const nonce=hex(crypto.getRandomValues(new Uint8Array(32))),issued=Math.floor(now/1000);
  const payload=nonce+'.'+issued;
  return {id:nonce,value:payload+'.'+await signature(payload,secret,scope)};
}
export async function readSession(value,secret,now=Date.now(),scope='eighty'){
  if(typeof secret!=='string'||secret.length<32||typeof value!=='string')return null;
  const match=value.match(/^([a-f0-9]{64})\.(\d{10})\.([a-f0-9]{64})$/);
  if(!match)return null;
  const age=now-Number(match[2])*1000;
  if(age< -60000||age>SESSION_TTL)return null;
  return equal(match[3],await signature(match[1]+'.'+match[2],secret,scope))?match[1]:null;
}
export function cookieName(url){return url.protocol==='https:'?'__Host-eighty-free':'eighty_free_'+(url.port||'local');}
export function cookieHeader(url,value){return cookieName(url)+'='+value+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+SESSION_TTL/1000+(url.protocol==='https:'?'; Secure':'');}
