// Actual local Cloudflare runtime: signed cookies, private tables, WebSocket
// transport and SQLite persistence. Upstream models are synthetic fixtures.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import WebSocket from 'ws';
import './build-worker-assets.mjs';

const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'eighty-free-check-'));
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const base='http://127.0.0.1:'+port,providerSecret='fixture-provider-secret-kept-off-the-browser',gatewaySecret='fixture-signing-secret-not-a-real-credential';
let child,logs='',ws;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function start(){
  logs='';child=spawn(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','--config','test/fixtures/free-worker.jsonc','--port',String(port),'--inspector-port','0','--persist-to',dir,'--log-level','warn'],{cwd:root,env:{PATH:process.env.PATH,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b;});child.stderr.on('data',b=>{logs+=b;});
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('Worker exited: '+logs);try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).ok)return;}catch{}await sleep(200);}
  throw new Error('Free Worker did not start: '+logs);
}
async function stop(){
  if(!child||child.exitCode!==null)return;
  const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await done;clearTimeout(timer);
}
const get=(path,cookie,extra={})=>fetch(base+path,{headers:{...(cookie?{cookie}:{}),...extra}});
const post=(path,cookie,csrf,body)=>fetch(base+path,{method:'POST',headers:{cookie,'x-eighty-csrf':csrf,'content-type':'application/json',origin:base},body:JSON.stringify(body)});
async function newBrowser(){const r=await get('/api/state?seat=0');assert.equal(r.status,200);return{cookie:r.headers.get('set-cookie').split(';')[0],data:await r.json()};}
function noKeys(value){const text=typeof value==='string'?value:JSON.stringify(value);assert.equal(text.includes(providerSecret),false);assert.equal(text.includes(gatewaySecret),false);}
async function openSocket(cookie){
  const messages=[];
  const connection=new WebSocket(base.replace('http:','ws:')+'/api/events?seat=0&client=fixture&visible=true',{headers:{cookie,origin:base}});
  connection.on('message',b=>{const data=JSON.parse(b.toString());noKeys(data);messages.push(data);});
  await new Promise((resolve,reject)=>{connection.once('open',resolve);connection.once('error',reject);});
  for(let i=0;i<50&&!messages.length;i++)await sleep(20);
  assert.ok(messages.length,'WebSocket supplies the initial private view');
  return{connection,messages};
}
try{
  await start();
  const a=await newBrowser(),b=await newBrowser();
  assert.notEqual(a.cookie,b.cookie);assert.notEqual(a.data.csrf,b.data.csrf);noKeys(a.data);
  assert.equal(a.data.siteEdition.hosting,'workers-free');assert.equal(a.data.capabilities.webSocket,true);
  for(const path of ['/app.js','/src/cards.js']){const r=await get(path);assert.equal(r.status,200);noKeys(await r.text());}
  for(const path of ['/.dev.vars','/.env','/src/game.js','/server/session.js'])assert.equal((await get(path)).status,404);
  assert.equal((await get('/api/state',a.cookie,{'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await post('/api/start',a.cookie,'wrong',{})).status,403);
  const denied=await post('/api/connections/save',a.cookie,a.data.csrf,{key:'visitor-key-must-not-be-saved'});
  if(denied.status!==403)throw new Error('Connection write boundary: '+denied.status+' '+(await denied.text()).replaceAll(providerSecret,'[redacted]').replaceAll(gatewaySecret,'[redacted]')+'\n'+logs);
  assert.equal((await post('/_eighty/sponsored/sponsored-fixture',a.cookie,a.data.csrf,{})).status,404,'there is no public model proxy');
  const channel=await openSocket(a.cookie);ws=channel.connection;
  ws.send('{"type":"ping"}');
  for(let i=0;i<50&&!channel.messages.some(m=>m.type==='pong');i++)await sleep(20);
  assert.ok(channel.messages.some(m=>m.type==='pong'),'hibernation auto-response is active');
  assert.equal((await post('/api/start',a.cookie,a.data.csrf,{seats:Array.from({length:4},(_,i)=>({kind:'human',name:'Fixture '+i}))})).status,200);
  const state=await (await get('/api/state?seat=-1',a.cookie)).json();
  const current=await (await get('/api/state?seat='+state.game.pending.seat,a.cookie)).json();
  assert.equal(state.game.hand.length,0);assert.equal('hands' in state.game,false);assert.equal('seed' in state.game,false);
  const envelope={seat:state.game.pending.seat,version:current.game.version,decisionId:state.game.pending.id,action:{type:'declare',choice:'pass'}};
  assert.equal((await post('/api/action',a.cookie,a.data.csrf,envelope)).status,200);
  assert.equal((await post('/api/action',a.cookie,a.data.csrf,envelope)).status,400,'stale actions stay rejected');
  assert.equal((await (await get('/api/state?seat=0',b.cookie)).json()).game,null);
  assert.equal((await post('/api/pause',b.cookie,a.data.csrf,{paused:true})).status,403);
  const before=await (await get('/api/state?seat=0',a.cookie)).json();noKeys(before);
  assert.equal((await post('/api/fixture-private-checkpoint',a.cookie,a.data.csrf,{})).status,200);
  const afterPrivate=await (await get('/api/state?seat=0',a.cookie)).json();
  assert.equal(afterPrivate.revision,before.revision,'private bidding work cannot leak through the public revision counter');
  await post('/api/pause',a.cookie,a.data.csrf,{paused:true});
  ws.close();ws=null;
  await stop();await start();
  const restored=await (await get('/api/state?seat=0',a.cookie)).json();
  assert.equal(restored.game.id,before.game.id);assert.equal(restored.game.version,before.game.version);
  assert.equal(restored.csrf,a.data.csrf,'hibernation/restart retains the session CSRF token');
  assert.ok(restored.revision>before.revision);assert.equal(restored.paused,true);noKeys(restored);
  const forged=a.cookie.replace(/=(.)/,(_m,c)=>'='+(c==='a'?'b':'a'));
  assert.equal((await post('/api/pause',forged,a.data.csrf,{paused:false})).status,401);
  const probe=await (await get('/api/state?seat=0',b.cookie,{'x-eighty-session':a.cookie.split('=')[1].split('.')[0]})).json();
  assert.equal(probe.game,null,'spoofed internal headers cannot select another table');
  // Exercise the complete controller -> internal binding -> sponsored broker
  // path too. The fixture handles the provider response without any network call.
  assert.equal((await post('/api/start',b.cookie,b.data.csrf,{dealing:'ordered',speed:50,limits:{maxRequests:4},
    seats:Array.from({length:4},(_,i)=>({kind:'api',name:'Hosted '+i,provider:'qwen',connectionId:'sponsored-fixture',model:'fixture-model'}))})).status,200);
  let hosted;
  for(let i=0;i<100;i++){
    hosted=await (await get('/api/state?seat=0',b.cookie)).json();noKeys(hosted);
    if(hosted.stats.input>=10)break;
    await sleep(50);
  }
  assert.ok(hosted.stats.realRequests>=1,'the hosted connection reaches the synthetic provider');
  assert.ok(hosted.stats.input>=10,'provider usage returns through the internal broker');
  assert.equal(hosted.stats.errors,0);assert.equal(hosted.stats.fallbacks,0);
  assert.ok(hosted.config.seats.every(seat=>seat.endgameAnalysis===false));
  assert.equal((await post('/api/pause',b.cookie,b.data.csrf,{paused:true})).status,200);
  noKeys(await (await get('/api/audit',b.cookie)).json());
  console.log('Free Worker native checks passed: no public keys, signed cookies, isolated tables, WebSocket auto-response, legal/stale actions, SQLite recovery, and the internal sponsored-provider route. No live model calls.');
}finally{ws?.terminate();await stop();await rm(dir,{recursive:true,force:true});}
