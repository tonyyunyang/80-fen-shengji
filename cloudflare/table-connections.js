import {Connections} from '../server/connections.js';
import {HostedConnections} from './hosted-connections.js';
import {publicProviderFetch} from './public-provider-fetch.js';

export class TableConnections {
  constructor(env,identity,{saved=[],fetchImpl,keysChanged=()=>{}}={}){
    this.hosted=new HostedConnections(env,identity);this.enabled=env.PERSONAL_CONNECTIONS_ENABLED==='true';
    this.personal=new Connections({saved:this.enabled?saved:[],fetchImpl:fetchImpl||publicProviderFetch()});
    this.keysChanged=keysChanged;
  }
  get profiles(){return this.hosted.profiles;}
  hasKeys(){return this.personal.keys.size>0;}
  list(){return [...this.hosted.list(),...this.personal.list()];}
  snapshot(){return this.personal.snapshot();}
  status(){const a=this.hosted.status(),b=this.personal.status();return {mock:true,qwen:a.qwen||b.qwen,openai:b.openai,claude:a.claude||b.claude};}
  own(id){
    if(!this.enabled)throw new Error('个人 API 连接未启用');
    if(id?.startsWith('sponsored-'))throw new Error('网站提供的连接不能修改');
    if(id&&!this.personal.profiles.has(id))throw new Error('所选 API 连接不存在');
  }
  save(input){
    this.own(input?.id);
    const candidate=this.personal.validate(input),all=this.personal.snapshot().filter(p=>p.id!==input.id).concat(candidate);
    if(new TextEncoder().encode(JSON.stringify(all)).byteLength>262144)throw new Error('连接模型列表过大，请保留常用模型');
    const id=this.personal.save(input);this.keysChanged();return id;
  }
  discover(input){this.own(input?.id);return this.personal.discover(input);}
  forget(id){this.own(id);this.personal.forget(id);this.keysChanged();}
  remove(id){this.own(id);this.personal.remove(id);this.keysChanged();}
  clearKeys(){this.personal.forget();this.keysChanged();}
  bind(seat){
    const bound=seat.connectionId?.startsWith('sponsored-')?this.hosted.bind(seat):this.personal.bind(seat);
    return bound.kind==='api'?{...bound,endgameAnalysis:false}:bound;
  }
  resolve(seat){return seat.connectionId?.startsWith('sponsored-')?this.hosted.resolve(seat):this.personal.resolve(seat);}
  needsKeys(state){return state?.seats.some(s=>s.kind==='api'&&s.provider!=='mock'&&!s.connectionId?.startsWith('sponsored-')&&!this.personal.keys.has(s.connectionId));}
}
