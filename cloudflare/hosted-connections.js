import { publicProfiles } from './sponsor-core.js';

// The Free runtime exposes only the host's fixed connections. Private keys
// stay in Worker Secrets and are used by the internal sponsored broker.
export class HostedConnections {
  constructor(env,identity){
    this.env=env;this.identity=identity;
    this.profiles=publicProfiles(env).map(p=>({id:p.id,name:p.name,provider:'qwen',baseUrl:p.baseUrl,
      models:[{id:p.model,label:p.label||p.model,input:null,output:null}],active:true,sponsored:true,default:p.default===true}));
  }
  list(){return structuredClone(this.profiles);}
  snapshot(){return [];}
  status(){return {mock:true,qwen:this.profiles.length>0,openai:false,claude:false};}
  bind(seat){
    if(seat.kind!=='api'||seat.provider==='mock')return seat;
    const p=this.profiles.find(p=>p.id===seat.connectionId);
    if(!p?.models.some(m=>m.id===seat.model))throw new Error('请选择网站提供的模型，或使用免费陪练');
    return {...seat,provider:'qwen',endgameAnalysis:false};
  }
  resolve(seat){
    if(seat.provider==='mock')return {env:{}};
    const p=this.profiles.find(p=>p.id===seat.connectionId);
    if(!p||seat.provider!=='qwen'||!p.models.some(m=>m.id===seat.model))return {env:{}};
    return {env:{QWEN_API_KEY:'eighty-gateway-managed',QWEN_BASE_URL:p.baseUrl},allowCustomModel:true,referencePrice:null,
      fetchImpl:async(url,options)=>{
        if(url!==p.baseUrl+'/chat/completions'||options.method!=='POST'||typeof options.body!=='string'||new TextEncoder().encode(options.body).byteLength>65536)throw new Error('Invalid sponsored request');
        const {session,visitor}=this.identity();
        if(!/^[a-f0-9]{64}$/.test(session||'')||!/^[a-f0-9]{64}$/.test(visitor||''))throw new Error('Invalid table identity');
        const req=new Request('https://internal.eighty/_eighty/sponsored/'+p.id,{method:'POST',body:options.body,signal:options.signal,
          headers:{'content-type':'application/json',authorization:'Bearer '+this.env.EIGHTY_GATEWAY_SECRET,'x-eighty-session':session,'x-eighty-visitor':visitor}});
        return this.env.SPONSORED_AI.getByName('daily-allowance').fetch(req);
      }};
  }
}
