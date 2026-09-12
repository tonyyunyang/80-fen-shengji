import { DurableObject } from 'cloudflare:workers';
import { Session } from '../server/session.js';
import { HumanPresence } from '../server/presence.js';
import { TableConnections } from './table-connections.js';
import { boundedText, secretMatches } from './sponsor-core.js';
import { SESSION_TTL } from './session-cookie.js';

const response=(status,data)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const randomToken=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
const identity=/^[a-f0-9]{64}$/;

// One authoritative table per signed browser cookie. The existing controller,
// rules and practice policy run here unchanged. Hibernating WebSockets keep
// an idle menu connected without a continuously running container or stream.
export class GameTable extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    this.sockets=new Map();this.mutations=[];this.restoring=true;this.saveFailed=false;this.idleTimer=null;
    this.keyTimer=null;this.lastPublicActivity=Date.now();
    this.ready=ctx.blockConcurrencyWhile(async()=>{
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS game_checkpoint (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)');
      const row=[...ctx.storage.sql.exec('SELECT data FROM game_checkpoint WHERE id = 1')][0];
      let saved=row?JSON.parse(row.data):null;
      this.expired=!!saved&&saved.expiresAt<=Date.now();
      if(this.expired){ctx.storage.sql.exec('DELETE FROM game_checkpoint');saved=null;}
      this.csrf=saved?.csrf||randomToken();this.revision=saved?.revision||0;
      this.mutations=Array.isArray(saved?.mutations)?saved.mutations.filter(t=>Number.isFinite(t)&&Date.now()-t<60000).slice(-180):[];
      this.ownerId=saved?.ownerId||null;this.visitor=saved?.visitor||null;
      this.expiresAt=saved?.expiresAt||Date.now()+SESSION_TTL;
      this.auditRows=Array.isArray(saved?.auditRows)?saved.auditRows.slice(-2000):[];
      this.snapshot=saved?.snapshot||null;this.lastCommitted=saved?JSON.stringify(saved):null;
      this.connections=new TableConnections(env,()=>({session:this.ownerId,visitor:this.visitor}),{saved:saved?.connections||[],fetchImpl:this.personalFetch(),keysChanged:()=>this.keepKeysAlive()});
      this.session=new Session({env:{},connections:this.connections,persist:(data,published)=>this.save(data,published),audit:entry=>{
        this.auditRows.push({at:new Date().toISOString(),...entry});
        if(this.auditRows.length>2000)this.auditRows.shift();
      }});
      this.presence=new HumanPresence(this.session);
      if(saved?.snapshot?.state)this.session.restore(saved.snapshot);
      for(const ws of ctx.getWebSockets()){
        try{const meta=ws.deserializeAttachment();if(meta)this.attach(ws,meta);}catch{}
      }
      if(saved?.snapshot?.state&&saved.paused===false&&this.visibleSockets()&&!this.connections.needsKeys(this.session.state))this.session.pause(false);
      this.restoring=false;
      // Hibernation retains the CSRF token; revisions remain monotonic.
      this.revision++;
      this.session.listeners.add(()=>{this.presence.check();this.broadcast();});
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}','{"type":"pong"}'));
    });
  }
  personalFetch(){return undefined;}
  personalKeyLifetime(){return 30*60*1000;}
  keepKeysAlive(){
    clearTimeout(this.keyTimer);this.keyTimer=null;
    if(!this.connections?.hasKeys())return;
    // A timer prevents hibernation from silently losing a configured key.
    // Its deadline follows public browser activity, never private bidding work.
    const remaining=this.personalKeyLifetime()-(Date.now()-this.lastPublicActivity);
    this.keyTimer=setTimeout(()=>{
      this.keyTimer=null;
      if(Date.now()-this.lastPublicActivity<this.personalKeyLifetime()){this.keepKeysAlive();return;}
      this.connections.clearKeys();
      if(this.session.state)this.session.pause(true,'credentials');
      this.persist();this.broadcast();
    },Math.max(100,remaining));
  }
  visibleSockets(){return [...this.sockets.keys()].some(ws=>ws.readyState===1&&ws.deserializeAttachment()?.visible);}
  attach(ws,meta){
    const detach=this.presence.attach(meta.seat,meta.clientId,meta.visible);
    this.sockets.set(ws,{meta,detach});
  }
  record(){return {snapshot:this.snapshot,csrf:this.csrf,revision:this.revision,paused:this.session.paused,
    ownerId:this.ownerId,visitor:this.visitor,expiresAt:this.expiresAt,auditRows:this.auditRows,mutations:this.mutations,connections:this.connections.snapshot()};}
  persist(){
    if(this.restoring)return;
    const data=JSON.stringify(this.record());
    try{
      if(new TextEncoder().encode(data).byteLength>1048576)throw new Error('Checkpoint limit');
      this.ctx.storage.sql.exec('INSERT INTO game_checkpoint (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',data);
      this.lastCommitted=data;this.saveFailed=false;
    }catch{
      this.saveFailed=true;this.session.stop();
      // Do not broadcast an action that failed to reach durable storage.
      this.restoring=true;
      try{if(this.lastCommitted){const old=JSON.parse(this.lastCommitted);if(old.snapshot?.state)this.session.restore(old.snapshot);}}
      finally{this.restoring=false;this.session.paused=true;this.session.pauseReason='storage';}
      for(const ws of this.sockets.keys())try{ws.close(1011,'Storage is temporarily unavailable');}catch{}
      throw Object.assign(new Error('牌局存档暂时不可用，请稍后重试'),{status:503});
    }
  }
  save(data,published){
    this.snapshot=data;
    if(!this.restoring){
      // Private bidding checkpoints must not reveal model activity through
      // a public revision counter. Match the Node server's listener semantics.
      if(published)this.revision++;
      this.persist();
    }
  }
  async touch(){this.lastPublicActivity=Date.now();this.expired=false;this.expiresAt=Date.now()+SESSION_TTL;this.keepKeysAlive();this.persist();await this.ctx.storage.setAlarm(this.expiresAt);}
  view(seat){return {...this.session.view(seat),connections:this.connections.list(),csrf:this.csrf,revision:this.revision,
    hosted:true,restoreAvailable:false,saveFailed:this.saveFailed,
    siteEdition:{name:'Tony’s website edition',branch:'codex/tonytheyang-site',repository:'https://github.com/tonyyunyang/80-fen-shengji',sponsored:this.connections.profiles.length>0,hosting:'workers-free'},
    capabilities:{webSocket:true,personalConnections:this.connections.enabled,personalKeyTtlMinutes:30,endgameAnalysis:false}};}
  broadcast(){
    if(this.saveFailed)return;
    for(const [ws,{meta}]of this.sockets)try{ws.send(JSON.stringify(this.view(meta.seat)));}catch{this.detach(ws);}
  }
  detach(ws){
    this.sockets.get(ws)?.detach();this.sockets.delete(ws);this.checkAway();
  }
  checkAway(){
    clearTimeout(this.idleTimer);this.idleTimer=null;
    if(!this.session.state||this.session.paused||this.session.state.score||this.visibleSockets())return;
    this.idleTimer=setTimeout(()=>{this.idleTimer=null;if(!this.visibleSockets()&&!this.session.paused)this.session.pause(true,'away');},5000);
  }
  async fetch(request){
    await this.ready;
    try{
      if(!await secretMatches('Bearer '+request.headers.get('x-eighty-gateway'),this.env.EIGHTY_GATEWAY_SECRET))return response(403,{error:'Gateway rejected'});
      const owner=request.headers.get('x-eighty-session'),visitor=request.headers.get('x-eighty-visitor');
      if(!identity.test(owner||'')||!identity.test(visitor||'')||this.ownerId&&this.ownerId!==owner)return response(403,{error:'Session rejected'});
      this.ownerId=owner;this.visitor||=visitor;
      await this.touch();
      const url=new URL(request.url),seat=Number(url.searchParams.get('seat')??-1),path=url.pathname;
      if(path==='/api/state'&&request.method==='GET')return response(200,this.view(seat));
      if(path==='/api/events'&&request.method==='GET'){
        if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')return response(426,{error:'WebSocket connection required'});
        const clientId=(url.searchParams.get('client')||'').slice(0,80);
        if(!Number.isInteger(seat)||seat< -1||seat>3||!clientId)return response(400,{error:'Invalid viewer'});
        const pair=new WebSocketPair(),client=pair[0],server=pair[1];
        const meta={seat,clientId,visible:url.searchParams.get('visible')!=='false'};
        this.ctx.acceptWebSocket(server);server.serializeAttachment(meta);this.attach(server,meta);this.checkAway();
        server.send(JSON.stringify(this.view(seat)));
        return new Response(null,{status:101,webSocket:client});
      }
      if(path==='/api/replay'&&request.method==='GET'){
        const v=this.view(seat);
        return response(200,{version:2,ruleset:v.game?.ruleset,rules:v.game?.rules,dealing:v.game?.dealing,dealIntervalMs:v.config?.dealIntervalMs,
          events:v.game?.events||[],rounds:v.game?.rounds||[],stats:v.stats,statsDeferred:v.statsDeferred,archives:v.archives});
      }
      if(path==='/api/audit'&&request.method==='GET'){
        const v=this.session.view(-1);
        if(v.statsDeferred)return response(409,{error:'本局结束后才能导出完整用量记录'});
        return response(200,{entries:this.auditRows,stats:v.stats,archives:v.archives});
      }
      if(request.method!=='POST')return response(404,{error:'Not found'});
      if(!request.headers.get('content-type')?.startsWith('application/json'))return response(415,{error:'JSON required'});
      if(!await secretMatches('Bearer '+request.headers.get('x-eighty-csrf'),this.csrf))return response(403,{error:'页面验证已过期，请刷新后重试'});
      const now=Date.now();this.mutations=this.mutations.filter(t=>now-t<60000);
      if(this.mutations.length>=180)return response(429,{error:'操作过于频繁，请稍后重试'});
      this.mutations.push(now);
      this.persist();
      const data=JSON.parse(await boundedText(request.body,131072));
      if(path==='/api/start')this.session.start(data);
      else if(path==='/api/action')this.session.human(data);
      else if(path==='/api/pause')this.session.pause(data.paused===true);
      else if(path==='/api/next')this.session.next();
      else if(path==='/api/restart')this.session.restart();
      else if(path==='/api/autoplay')this.session.setAutoplay(data.seat,data.enabled===true);
      else if(path==='/api/presence'){
        if(typeof data.clientId!=='string'||typeof data.visible!=='boolean')return response(400,{error:'Invalid presence'});
        this.presence.visibility(data.clientId,data.visible);
        for(const [ws,entry]of this.sockets)if(entry.meta.clientId===data.clientId){entry.meta.visible=data.visible;ws.serializeAttachment(entry.meta);}
        this.checkAway();
      }
      else if(path==='/api/connections/save'){
        const id=this.connections.save(data);data.key='';
        if(this.session.state)this.session.pause(true,'credentials');this.persist();this.broadcast();return response(200,{ok:true,id});
      }else if(path==='/api/connections/discover'){
        try{return response(200,await this.connections.discover(data));}finally{data.key='';}
      }else if(path==='/api/connections/forget'||path==='/api/connections/delete'){
        if(path.endsWith('/delete'))this.connections.remove(data.id);else this.connections.forget(data.id);
        if(this.session.state)this.session.pause(true,'credentials');this.persist();this.broadcast();
      }
      else return response(404,{error:'Not found'});
      return response(200,{ok:true});
    }catch(error){return response(error.status||400,{error:error.status===503?error.message:error.message||'Request failed'});}
  }
  async webSocketMessage(ws,message){
    await this.ready;
    try{
      if(typeof message!=='string'||message.length>1024)throw new Error('Invalid message');
      const data=JSON.parse(message),entry=this.sockets.get(ws);
      if(!entry||data.type!=='presence'||typeof data.visible!=='boolean')throw new Error('Invalid presence');
      entry.meta.visible=data.visible;ws.serializeAttachment(entry.meta);
      this.presence.visibility(entry.meta.clientId,data.visible);this.checkAway();await this.touch();
      ws.send(JSON.stringify(this.view(entry.meta.seat)));
    }catch{try{ws.close(1008,'Invalid message');}catch{}}
  }
  async webSocketClose(ws,code,reason){await this.ready;try{ws.close(code,reason);}catch{}this.detach(ws);}
  async webSocketError(ws){await this.ready;this.detach(ws);}
  async alarm(){
    await this.ready;
    if(this.expired||Date.now()>=this.expiresAt){
      clearTimeout(this.idleTimer);clearTimeout(this.keyTimer);this.connections.clearKeys();this.session.stop();this.presence.stop();
      for(const ws of this.sockets.keys())try{ws.close(1000,'Table expired');}catch{}
      this.sockets.clear();await this.ctx.storage.deleteAll();
    }else await this.ctx.storage.setAlarm(this.expiresAt);
  }
}
