import test from 'node:test';
import assert from 'node:assert/strict';
import {TableConnections} from '../cloudflare/table-connections.js';
import {publicProviderFetch,publicAnswers} from '../cloudflare/public-provider-fetch.js';
import {profiles,sponsoredRequest} from '../cloudflare/sponsor-core.js';

const key='visitor-fixture-key-never-a-real-key';
const env={PERSONAL_CONNECTIONS_ENABLED:'true',SPONSORED_ENABLED:'true',EIGHTY_GATEWAY_SECRET:'fixture-gateway-secret-with-over-32-characters',SPONSOR_ALIBABA_API_KEY:'fixture-operator-key-not-a-real-key',
 SPONSOR_DAILY_REQUESTS:'10',SPONSOR_SESSION_REQUESTS:'10',SPONSOR_VISITOR_REQUESTS:'10',SPONSOR_MAX_OUTPUT_TOKENS:'512',
 SPONSOR_PROFILES:JSON.stringify([{id:'sponsored-alibaba',name:'Host models',model:'qwen3.8-flash',models:['glm-5.2','qwen3.8-flash','deepseek-v4-pro'],baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',keySecret:'SPONSOR_ALIBABA_API_KEY',default:true}])};
const identity=()=>({session:'a'.repeat(64),visitor:'b'.repeat(64)});
const profile={name:'My OpenRouter',provider:'qwen',baseUrl:'https://openrouter.ai/api/v1',models:[{id:'vendor/text-model'}],key};
const offline=async()=>Response.json({data:[]});

test('Workers DNS aliases are not mistaken for IP addresses, and aliases alone do not authorize a request',async()=>{
 const resolve=host=>publicAnswers(host,[async()=>['load-balancer.example.','93.184.216.34'],async()=>['load-balancer.example.']]);
 assert.deepEqual(await resolve('provider.example'),[{address:'93.184.216.34',family:4}]);
 let calls=0;const upstream=async()=>{calls++;return Response.json({data:[]});};
 const options={method:'GET',headers:{authorization:'Bearer '+key}};
 assert.equal((await publicProviderFetch({resolve,fetchImpl:upstream})('https://provider.example/v1/models',options)).status,200);
 const aliases=host=>publicAnswers(host,[async()=>['load-balancer.example.'],async()=>[]]);
 await assert.rejects(()=>publicProviderFetch({resolve:aliases,fetchImpl:upstream})('https://provider.example/v1/models',options),/无法解析/);
 const privateAlias=host=>publicAnswers(host,[async()=>['load-balancer.example.','127.0.0.1'],async()=>[]]);
 await assert.rejects(()=>publicProviderFetch({resolve:privateAlias,fetchImpl:upstream})('https://provider.example/v1/models',options),/私有/);
 assert.equal(calls,1);
});

test('hosted models share one protected connection and retain the explicit default',()=>{
 const connections=new TableConnections(env,identity,{fetchImpl:offline});
 assert.deepEqual(connections.list()[0].models.map(m=>m.id),['qwen3.8-flash','glm-5.2','deepseek-v4-pro']);
 assert.equal(JSON.stringify(connections.list()).includes(env.SPONSOR_ALIBABA_API_KEY),false);
 assert.throws(()=>connections.save({...profile,id:'sponsored-alibaba'}),/不能修改/);
 assert.throws(()=>connections.forget('sponsored-alibaba'),/不能修改/);
 assert.throws(()=>connections.remove('sponsored-alibaba'),/不能修改/);
 const bound=connections.bind({kind:'api',connectionId:'sponsored-alibaba',model:'glm-5.2'});
 assert.equal(bound.provider,'qwen');assert.equal(bound.endgameAnalysis,false);
 assert.throws(()=>connections.bind({...bound,model:'not-entitled'}));
});

test('personal keys remain in the owning table memory and disappear on restore or clear',()=>{
 const a=new TableConnections(env,identity,{fetchImpl:offline}),b=new TableConnections(env,identity,{fetchImpl:offline});
 const id=a.save(profile),seat=a.bind({kind:'api',connectionId:id,model:'vendor/text-model'});
 assert.equal(a.resolve(seat).env.QWEN_API_KEY,key);assert.equal(b.resolve(seat).env.QWEN_API_KEY,undefined);
 assert.equal(a.hasKeys(),true);assert.equal(b.hasKeys(),false);
 assert.equal(JSON.stringify(a.list()).includes(key),false);assert.equal(JSON.stringify(a.snapshot()).includes(key),false);
 const restored=new TableConnections(env,identity,{saved:a.snapshot(),fetchImpl:offline});
 assert.equal(restored.list().find(p=>p.id===id).active,false);assert.equal(restored.hasKeys(),false);
 assert.equal(restored.needsKeys({seats:[seat]}),true);
 a.forget(id);assert.equal(a.hasKeys(),false);assert.equal(a.list()[0].active,true);
});

test('changing personal destinations cannot carry an old key along',()=>{
 const connections=new TableConnections(env,identity,{fetchImpl:offline});
 const id=connections.save(profile);
 connections.save({...profile,id,baseUrl:'https://other.example/v1',key:''});
 assert.equal(connections.hasKeys(),false);
 assert.throws(()=>connections.save({...profile,id:'00000000-0000-0000-0000-000000000000'}),/不存在/);
});

test('Worker transport rejects unsafe URLs and any non-public DNS answer before sending credentials',async()=>{
 let calls=0;
 const transport=publicProviderFetch({resolve:async()=>[{address:'93.184.216.34'},{address:'127.0.0.1'}],fetchImpl:async()=>{calls++;return Response.json({});}});
 const options={method:'POST',body:'{}',headers:{authorization:'Bearer '+key}};
 for(const url of ['http://example.com/v1/chat/completions','https://127.0.0.1/v1/chat/completions','https://[::1]/v1/chat/completions','https://169.254.169.254/v1/chat/completions','https://u:p@example.com/v1/chat/completions','https://example.com/v1/chat/completions?key=x','https://example.com/v1/chat/completions'])await assert.rejects(()=>transport(url,options));
 assert.equal(calls,0);
});

test('Worker DNS validation repeats on each call, redirects are rejected, and responses are bounded',async()=>{
 let resolutions=0,calls=0;
 const fetchImpl=async(_url,options)=>{calls++;assert.equal(options.redirect,'manual');return Response.json({choices:[]});};
 const options={method:'POST',body:'{}',headers:{authorization:'Bearer '+key}};
 const transport=publicProviderFetch({resolve:async()=>[{address:++resolutions===1?'93.184.216.34':'10.0.0.1'}],fetchImpl});
 await transport('https://provider.example/v1/chat/completions',options);await assert.rejects(()=>transport('https://provider.example/v1/chat/completions',options));assert.equal(calls,1);
 const redirects=publicProviderFetch({resolve:async()=>[{address:'93.184.216.34'}],fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1'}})});
 await assert.rejects(()=>redirects('https://provider.example/v1/chat/completions',options),/重定向/);
 const large=publicProviderFetch({resolve:async()=>[{address:'93.184.216.34'}],fetchImpl:async()=>new Response('x'.repeat(1048577))});
 await assert.rejects(()=>large('https://provider.example/v1/chat/completions',options));
});

test('cancelling during DNS resolution cannot send the key later',async()=>{
 let complete,calls=0;const controller=new AbortController();
 const transport=publicProviderFetch({resolve:()=>new Promise(r=>complete=r),fetchImpl:async()=>{calls++;return Response.json({});}});
 const result=transport('https://provider.example/v1/models',{method:'GET',headers:{authorization:'Bearer '+key},signal:controller.signal});controller.abort();await assert.rejects(()=>result);
 complete([{address:'93.184.216.34'}]);await Promise.resolve();assert.equal(calls,0);
});

test('a sponsored connection admits only its listed models',async()=>{
 assert.equal(profiles(env)[0].models.length,3);
 let calls=0;const storage={transaction:fn=>fn({get:async()=>new Map(),put:async()=>{}})};
 const make=model=>new Request('https://internal.eighty/_eighty/sponsored/sponsored-alibaba',{method:'POST',headers:{authorization:'Bearer '+env.EIGHTY_GATEWAY_SECRET,'x-eighty-session':'a'.repeat(64),'x-eighty-visitor':'b'.repeat(64)},body:JSON.stringify({model,messages:[{role:'user',content:'Synthetic fixture'}],max_tokens:512})});
 const fetchImpl=async(_url,options)=>{calls++;assert.equal(JSON.parse(options.body).model,'glm-5.2');return Response.json({choices:[]});};
 assert.equal((await sponsoredRequest(make('glm-5.2'),env,storage,fetchImpl)).status,200);
 assert.equal((await sponsoredRequest(make('unlisted'),env,storage,fetchImpl)).status,400);assert.equal(calls,1);
});
