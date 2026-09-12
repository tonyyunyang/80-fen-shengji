import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudCheckpoints } from '../server/cloud-checkpoints.js';
import { checkpointRequest } from '../cloudflare/checkpoints.js';
import { BrowserSessions } from '../server/browser-sessions.js';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const secret='fixture-cloud-checkpoint-secret-not-a-real-key';
const id='a'.repeat(64);
function bucket(){
  const objects=new Map();
  return {objects,async get(key){const value=objects.get(key);return value?{...value,size:Buffer.byteLength(value.text),body:new Response(value.text).body}:null;},
    async put(key,text,options){objects.set(key,{text,...options});},async delete(key){objects.delete(key);}};
}
function request(action,body='{}',authorization='Bearer '+secret){return new Request('https://game.example.com/_eighty/checkpoints/'+id+'/'+action,{method:'POST',headers:{authorization},body});}
test('private checkpoints round trip through R2 and expire after seven idle days',async()=>{
  const saves=bucket(),env={EIGHTY_GATEWAY_SECRET:secret,EIGHTY_SAVES:saves},now=Date.UTC(2026,8,11);
  const content=JSON.stringify({state:{id:'fixture-game'},connections:[]});
  assert.equal((await checkpointRequest(request('write',content),env,now)).status,200);
  assert.deepEqual(await (await checkpointRequest(request('read'),env,now+1000)).json(),JSON.parse(content));
  assert.equal((await checkpointRequest(request('read'),env,now+8*86400000)).status,404);
  assert.equal(saves.objects.size,0);
});
test('checkpoint authentication, path limits and storage failures never expose a saved table',async()=>{
  const saves=bucket(),env={EIGHTY_GATEWAY_SECRET:secret,EIGHTY_SAVES:saves};
  assert.equal((await checkpointRequest(request('write','{}','Bearer wrong'),env)).status,403);
  assert.equal((await checkpointRequest(request('delete'),env)).status,400);
  assert.equal((await checkpointRequest(request('read'),{EIGHTY_GATEWAY_SECRET:secret})).status,503);
  assert.equal((await checkpointRequest(request('write','x'.repeat(1048600)),env)).status,503);
  assert.equal(saves.objects.size,0);
});
test('the Node adapter uses only its fixed gateway and does not treat outages as missing saves',async()=>{
  const calls=[];
  const store=new CloudCheckpoints({gateway:'https://game.example.com',secret,fetchImpl:async(...args)=>{calls.push(args);return{ok:false,status:503};}});
  await assert.rejects(()=>store.read(id),/temporarily unavailable/);
  await assert.rejects(()=>store.write('../outside','{}'),/Invalid checkpoint/);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'https://game.example.com/_eighty/checkpoints/'+id+'/read');
  assert.equal(calls[0][1].headers.authorization,'Bearer '+secret);
});
test('browser saves survive a fresh controller while personal keys remain absent',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'eighty-cloud-checkpoint-'));
  const saved=new Map(),checkpoints={read:async key=>saved.has(key)?JSON.parse(saved.get(key)):null,write:async(key,content)=>saved.set(key,content)};
  let first,second;
  try{
    first=new BrowserSessions({directory,checkpoints});
    const context=await first.build(id,null);
    first.entries.set(id,context);
    context.connections.save({name:'Personal fixture',provider:'qwen',baseUrl:'https://example.com/v1',models:[{id:'fixture-model'}],key:'fixture-personal-key-must-not-persist'});
    context.session.start({seats:Array.from({length:4},(_,i)=>({kind:'human',name:'Seat '+i})),dealIntervalMs:600});
    context.session.pause(true);
    await context.writes;
    assert.equal(saved.size,1);
    assert.equal(saved.get(id).includes('fixture-personal-key-must-not-persist'),false);
    assert.deepEqual(await readdir(directory),[],'the cloud adapter does not write a second local checkpoint');
    second=new BrowserSessions({directory,checkpoints});
    const restored=await second.build(id,await second.saved(id));
    second.entries.set(id,restored);
    assert.equal(restored.session.state.id,context.session.state.id);
    assert.equal(restored.connections.list()[0].active,false);
    context.session.pause(true);context.presence.stop();restored.session.pause(true);restored.presence.stop();
  }finally{await first?.stop();await second?.stop();await rm(directory,{recursive:true,force:true});}
});
