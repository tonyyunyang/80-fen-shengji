import {boundedText,secretMatches,limits,reserve} from './sponsor-core.js';
import {publicProviderFetch} from './public-provider-fetch.js';

const json=(status,data)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');

// Explicitly enabled, operator-authenticated, fixed-endpoint diagnostics.
// This is never a visitor proxy and never returns a response body or a key.
export async function providerDiagnostics(request,env,storage,fetchImpl=fetch){
  if(env.EIGHTY_PROVIDER_DIAGNOSTICS!=='true'||request.method!=='POST'||!await secretMatches(request.headers.get('authorization'),env.EIGHTY_GATEWAY_SECRET))return json(404,{error:'Not found'});
  let input;try{input=JSON.parse(await boundedText(request.body,2048));}catch{return json(400,{error:'Invalid diagnostic request'});}
  if(!input||!['models','chat','messages'].includes(input.kind)||!['kimi','alibaba'].includes(input.provider))return json(400,{error:'Unknown diagnostic'});
  const key=env[input.provider==='kimi'?'SPONSOR_KIMI_API_KEY':'SPONSOR_ALIBABA_API_KEY'];
  if(!key)return json(503,{error:'Binding unavailable'});
  try{if(!await reserve(storage,limits(env),'operator-diagnostics','operator-diagnostics'))return json(429,{error:'Diagnostic allowance reached'});}
  catch{return json(503,{error:'Diagnostic allowance unavailable'});}
  const base=input.provider==='kimi'?'https://api.kimi.com/coding/v1':'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
  const model=input.provider==='kimi'?'kimi-for-coding':'qwen3.8-flash';
  const messages=input.kind==='messages',discovery=input.kind==='models';
  const headers={'accept':'application/json','content-type':'application/json','user-agent':'Eighty-Website/0.3.0 (tonytheyang.com)',...(messages?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{authorization:'Bearer '+key})};
  const body=messages?{model,max_tokens:128,thinking:{type:'disabled'},messages:[{role:'user',content:'Reply with OK.'}]}:{model,max_tokens:128,messages:[{role:'user',content:'Reply with OK.'}],...(input.provider==='kimi'?{reasoning_effort:'none'}:{enable_thinking:false})};
  const started=Date.now(),result={provider:input.provider,kind:input.kind,at:new Date().toISOString(),keyMatches:/^[a-f0-9]{64}$/.test(input.expectedKeyDigest||'')?await hash(key)===input.expectedKeyDigest:null};
  try{
    const personal=input.transport==='personal'&&discovery;
    const response=await (personal?publicProviderFetch({fetchImpl}):fetchImpl)(base+(discovery?'/models':messages?'/messages':'/chat/completions'),{method:discovery?'GET':'POST',headers,...(discovery?{}:{body:JSON.stringify(body)}),redirect:'manual',signal:AbortSignal.timeout(11000)});
    const text=personal?JSON.stringify(await response.json()):await boundedText(response.body,1048576);let data;try{data=JSON.parse(text);}catch{}
    const ray=response.headers.get('cf-ray'),requestId=response.headers.get('x-request-id');
    const code=text.match(/(?:error code:\s*|error\s+(?:<[^>]+>)*)(1\d{3})\b/i)?.[1];
    Object.assign(result,{status:response.status,json:!!data,bytes:new TextEncoder().encode(text).length,ms:Date.now()-started,
      html:/^\s*(?:<!doctype html|<html)/i.test(text),challenge:response.headers.get('cf-mitigated')==='challenge'||/cf-chl-|challenge-platform|just a moment/i.test(text),
      server:response.headers.get('server')==='cloudflare'?'cloudflare':'other',
      ...(code?{cloudflareCode:code}:{}),
      blockKind:/sorry, you have been blocked/i.test(text)?'blocked':/access denied/i.test(text)?'access-denied':/direct ip access/i.test(text)?'direct-ip':'unspecified',
      ...(ray&&/^[a-f0-9]{16}-[A-Z]{3}$/.test(ray)?{cfRay:ray}:{}),
      ...(requestId&&/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)&&!requestId.includes(key)?{requestId}:{}),
      responseKind:Array.isArray(data?.choices)?'chat':Array.isArray(data?.content)?'messages':Array.isArray(data?.data)?'models':data?.error?'error':'other',
      ...(Array.isArray(data?.data)?{models:data.data.map(m=>m.id).filter(id=>typeof id==='string'&&/^[a-zA-Z0-9._/-]{1,100}$/.test(id)&&!id.includes(key)).slice(0,64)}:{})});
  }catch(error){const known={'无法解析提供商地址':'dns','提供商地址解析到私有或保留网络':'non-public-dns','提供商请求已取消':'cancelled','提供商重定向被拒绝':'redirect'};Object.assign(result,{status:null,errorKind:known[error.message]||(error.name==='TimeoutError'?'timeout':'transport'),ms:Date.now()-started});}
  return json(200,result);
}
