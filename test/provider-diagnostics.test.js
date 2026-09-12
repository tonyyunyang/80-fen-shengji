import test from 'node:test';
import assert from 'node:assert/strict';
import {providerDiagnostics} from '../cloudflare/provider-diagnostics.js';

const gateway='fixture-diagnostic-gateway-not-a-real-key';
const key='fixture-diagnostic-provider-not-a-real-key';
const env={EIGHTY_GATEWAY_SECRET:gateway,EIGHTY_PROVIDER_DIAGNOSTICS:'true',SPONSOR_KIMI_API_KEY:key,
  SPONSOR_DAILY_REQUESTS:'2',SPONSOR_SESSION_REQUESTS:'2',SPONSOR_VISITOR_REQUESTS:'2',SPONSOR_MAX_OUTPUT_TOKENS:'512'};
const request=(data={},authorization='Bearer '+gateway)=>new Request('https://example.com/_eighty/provider-check',{
  method:'POST',headers:{authorization},body:JSON.stringify({provider:'kimi',kind:'models',...data})});
function storage(){const data=new Map();return {transaction:async fn=>fn({get:async keys=>new Map(keys.map(k=>[k,data.get(k)])),put:async values=>Object.entries(values).forEach(([k,v])=>data.set(k,v))})};}

test('diagnostics stay invisible unless enabled and operator-authenticated',async()=>{
  let calls=0;const upstream=async()=>{calls++;return Response.json({});};
  for(const [req,config]of [[request(),{...env,EIGHTY_PROVIDER_DIAGNOSTICS:'false'}],[request({},'Bearer wrong'),env],[new Request('https://example.com/_eighty/provider-check'),env]]){
    assert.equal((await providerDiagnostics(req,config,storage(),upstream)).status,404);
  }
  assert.equal((await providerDiagnostics(request({provider:'custom',baseUrl:'https://example.com'}),env,storage(),upstream)).status,400);
  assert.equal((await providerDiagnostics(new Request('https://example.com/_eighty/provider-check',{method:'POST',headers:{authorization:'Bearer '+gateway},body:'null'}),env,storage(),upstream)).status,400);
  assert.equal(calls,0);
});
test('diagnostics fix the destination, omit raw responses, compare keys privately and consume quota',async()=>{
  const store=storage(),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  let calls=0;
  const upstream=async(url,options)=>{
    calls++;assert.equal(url,'https://api.kimi.com/coding/v1/models');assert.equal(options.method,'GET');assert.equal(options.body,undefined);
    assert.equal(options.redirect,'manual');assert.equal(options.headers.authorization,'Bearer '+key);
    assert.equal(options.headers['user-agent'],'Eighty-Website/0.3.0 (tonytheyang.com)');
    return new Response('<html>Sorry, you have been blocked. error code: 1020 '+key+'</html>',{status:403,headers:{server:'cloudflare','cf-ray':'0123456789abcdef-AMS','x-request-id':key}});
  };
  const response=await providerDiagnostics(request({expectedKeyDigest:digest,baseUrl:'https://example.com'}),env,store,upstream);
  const result=await response.json();assert.equal(result.keyMatches,true);assert.equal(result.status,403);assert.equal(result.blockKind,'blocked');
  assert.equal(result.cloudflareCode,'1020');assert.equal(result.cfRay,'0123456789abcdef-AMS');assert.equal(result.requestId,undefined);
  assert.equal(JSON.stringify(result).includes(key),false);assert.equal(JSON.stringify(result).includes('<html>'),false);
  assert.equal((await providerDiagnostics(request(),env,store,upstream)).status,200);
  assert.equal((await providerDiagnostics(request(),env,store,upstream)).status,429);assert.equal(calls,2);
});
test('diagnostic allowance failures never send credentials upstream',async()=>{
  const result=await providerDiagnostics(request(),env,{transaction:async()=>{throw new Error('unavailable');}},async()=>{assert.fail('must not fetch');});
  assert.equal(result.status,503);
});
