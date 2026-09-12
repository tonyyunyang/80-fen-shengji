// Bounded local workerd smoke test. No external providers or real visitor data.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
import {performance} from 'node:perf_hooks';
import WebSocket from 'ws';
import './build-worker-assets.mjs';

const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'eighty-100-tables-'));
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const base='http://127.0.0.1:'+port,tables=[],sockets=[],timings=[];let child,logs='';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path,table,body) {
  const at=performance.now();const response=await fetch(base+path,{method:body?'POST':'GET',headers:{origin:base,'cf-connecting-ip':table.ip,...(table.cookie?{cookie:table.cookie}:{}),...(body?{'content-type':'application/json','x-eighty-csrf':table.csrf}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  timings.push(performance.now()-at);return response;
}
try{
  child=spawn(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','-c','test/fixtures/free-worker.jsonc','--port',String(port),'--inspector-port','0','--persist-to',dir,'--log-level','warn'],{cwd:root,env:{PATH:process.env.PATH,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(child.exitCode!==null)throw new Error('Local worker exited: '+logs);await sleep(150);}
  const started=performance.now();
  await Promise.all(Array.from({length:100},async(_,i)=>{
    const table={ip:'198.51.100.'+(i+1)};tables.push(table);
    const r=await request('/api/state?seat=0',table);assert.equal(r.status,200);table.cookie=r.headers.get('set-cookie').split(';')[0];table.csrf=(await r.json()).csrf;
    const start=await request('/api/start',table,{dealing:'ordered',speed:100,seats:Array.from({length:4},(_,seat)=>({kind:'human',name:'Synthetic '+seat}))});assert.equal(start.status,200);
    const state=await(await request('/api/state?seat=0',table)).json();table.id=state.game.id;
    const ws=new WebSocket(base.replace('http:','ws:')+'/api/events?seat=0&client=concurrency&visible=true',{headers:{cookie:table.cookie,origin:base,'cf-connecting-ip':table.ip}});sockets.push(ws);
    ws.on('message',bytes=>{const view=JSON.parse(bytes.toString());if(view.game)assert.equal(view.game.id,table.id,'a socket received another table');});
    await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    const own=await(await request('/api/state?seat='+state.game.pending.seat,table)).json();
    assert.equal((await request('/api/action',table,{seat:own.game.pending.seat,version:own.game.version,decisionId:own.game.pending.id,action:{type:'declare',choice:'pass'}})).status,200);
    const after=await(await request('/api/state?seat=0',table)).json();assert.equal(after.game.id,table.id);assert.ok(after.game.version>own.game.version);assert.equal(after.stats.realRequests,0);
  }));
  assert.equal(new Set(tables.map(t=>t.id)).size,100);assert.equal(new Set(tables.map(t=>t.cookie)).size,100);
  const [a,b]=tables;assert.equal((await request('/api/pause',{...b,csrf:a.csrf},{paused:true})).status,403);
  timings.sort((a,b)=>a-b);
  const report={test:'100 simultaneous isolated local workerd tables',at:new Date().toISOString(),tables:100,websockets:sockets.length,independentGameIds:100,realModelRequests:0,
    requests:timings.length,elapsedSeconds:Math.round((performance.now()-started)/100)/10,p50Ms:Math.round(timings[Math.floor(timings.length*.5)]),p95Ms:Math.round(timings[Math.floor(timings.length*.95)]),
    limits:'Local smoke test only; excludes production CPU/duration quotas, Internet latency and real provider concurrency.'};
  await mkdir(resolve(root,'output/scaling'),{recursive:true});await writeFile(resolve(root,'output/scaling/100-tables.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
  await Promise.allSettled(tables.filter(t=>t.cookie&&t.csrf).map(t=>request('/api/pause',t,{paused:true})));for(const ws of sockets)ws.terminate();
  if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await done;clearTimeout(timer);}
  await rm(dir,{recursive:true,force:true});
}
