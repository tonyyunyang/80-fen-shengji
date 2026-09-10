import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Connections } from '../server/connections.js';
import { modelPrice, modelsUrl } from '../server/model-discovery.js';
import { safeProviderFetch } from '../server/safe-network.js';

const key='fixture-private-key-'+ 'x'.repeat(125);
const profile={name:'Example service',provider:'qwen',baseUrl:'https://example.com/v1',models:[]};
const ok=data=>({ok:true,status:200,json:async()=>data});

test('fresh connections have no packaged provider or pricing catalog',()=>{
  assert.deepEqual(new Connections().list(),[]);
});
test('model discovery uses the chosen protocol, deduplicates and keeps unsupported models out',async()=>{
  let url,options;
  const store=new Connections({fetchImpl:async(u,o)=>{url=u;options=o;return ok({data:[
    {id:'text-model',display_name:'Readable model',pricing:{currency:'USD',unit:'per_million_tokens',input:.1,output:.5}},
    {id:'text-model'}, {id:'image-only',architecture:{output_modalities:['image']}},
    {id:'no-tools',supported_parameters:['temperature']}, {id:'unknown-capability'}, {id:'wan2.7-image'}, {id:'qwen-audio-3.0-tts-plus'},
    {id:'echo',name:key}, {id:key}, {id:'not valid'}, {id:42,supported_parameters:{}}, null,
  ]});}});
  const result=await store.discover({...profile,key});
  assert.equal(url,'https://example.com/v1/models');assert.equal(options.method,'GET');assert.equal(options.headers.authorization,'Bearer '+key);assert.equal(options.body,undefined);
  assert.deepEqual(result.models.map(m=>m.id),['text-model','unknown-capability']);assert.equal(result.models[1].input,null);assert.equal(result.models[0].output,.5);
  assert.equal(JSON.stringify(result).includes(key.slice(0,80)),false);assert.equal(store.keys.size,0);
  await store.discover({...profile,provider:'claude',baseUrl:'https://example.com',key});
  assert.equal(url,'https://example.com/v1/models');assert.equal(options.headers['x-api-key'],key);assert.equal(options.headers.authorization,undefined);
  assert.equal(modelsUrl({...profile,provider:'claude'}),'https://example.com/v1/models');
});
test('discovery never moves saved keys to a changed destination and is single-flight',async()=>{
  let release,calls=0;
  const store=new Connections({fetchImpl:()=>{calls++;return new Promise(resolve=>release=()=>resolve(ok({data:[]})));}});
  const id=store.save({...profile,key});
  await assert.rejects(store.discover({...profile,id,baseUrl:'https://elsewhere.example/v1'}),/key/);assert.equal(calls,0);
  const first=store.discover({...profile,id});await assert.rejects(store.discover({...profile,id}),/稍候/);release();await first;assert.equal(calls,1);
  store.forget(id);await assert.rejects(store.discover({...profile,id}),/key/);
});
test('provider errors and malformed responses cannot echo secrets; partial discovery is explicit',async()=>{
  for(const response of [{ok:false,status:401,json:async()=>({error:key})},{ok:false,status:302,json:async()=>({error:key})},ok({error:key})]){
    const store=new Connections({fetchImpl:async()=>response});
    await assert.rejects(store.discover({...profile,key}),error=>!error.message.includes(key));
  }
  const store=new Connections({fetchImpl:async()=>ok({data:Array.from({length:270},(_,i)=>({id:'model-'+i})),has_more:true})});
  const result=await store.discover({...profile,key});assert.equal(result.models.length,256);assert.equal(result.partial,true);
});
test('price metadata needs known currency and units; OpenRouter token prices normalize to millions',()=>{
  assert.deepEqual(modelPrice({pricing:{input:1,output:3}},profile.baseUrl),{input:null,output:null});
  assert.deepEqual(modelPrice({pricing:{currency:'EUR',unit:'per_token',input:1,output:3}},profile.baseUrl),{input:null,output:null});
  assert.deepEqual(modelPrice({pricing:{prompt:'0.000001',completion:'0.000003'}},'https://openrouter.ai/api/v1'),{input:1,output:3});
  assert.deepEqual(modelPrice({pricing:{currency:'USD',unit:'per_million_tokens',input:0,output:'NaN'}},profile.baseUrl),{input:0,output:null});
});
test('GET model transport is DNS-checked, read-only and never follows a redirect',async()=>{
  let calls=0;
  const server=http.createServer((req,res)=>{calls++;assert.equal(req.method,'GET');res.writeHead(302,{location:'/private'});res.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const transport=safeProviderFetch({allowLoopback:true});
    const response=await transport(base+'/v1/models',{method:'GET',headers:{},signal:AbortSignal.timeout(1000)});
    assert.equal(response.status,302);assert.equal(calls,1);
    await assert.rejects(transport(base+'/other',{method:'GET',headers:{}}),/不支持/);
    await assert.rejects(transport(base+'/v1/models',{method:'DELETE',headers:{}}),/不支持/);
    await assert.rejects(safeProviderFetch()('https://127.0.0.1/v1/models',{method:'GET',headers:{}}),/私有/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
