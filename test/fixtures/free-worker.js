import worker from '../../cloudflare/free-worker.js';
import { SponsoredAI } from '../../cloudflare/sponsored-object.js';
import { sponsoredRequest } from '../../cloudflare/sponsor-core.js';
import { GameTable as AuthoritativeTable } from '../../cloudflare/game-table.js';
import {publicProviderFetch,publicAnswers} from '../../cloudflare/public-provider-fetch.js';

// A fixture-only checkpoint trigger exercises the privacy boundary without
// relying on randomly dealt hands to happen to make a bot eligible to bid.
// The production entry exports AuthoritativeTable directly, without this route.
export class GameTable extends AuthoritativeTable {
  personalKeyLifetime(){return 5000;}
  personalFetch(){return publicProviderFetch({resolve:host=>publicAnswers(host,[async()=>['fixture-alias.example.','93.184.216.34'],async()=>['fixture-alias.example.']]),fetchImpl:async(url,options)=>{
    const key=options.headers.authorization?.replace(/^Bearer /,'')||options.headers['x-api-key'];
    if(!url.startsWith('https://fixture-provider.example/v1/')||key!=='visitor-fixture-key-not-a-live-credential')return Response.json({error:{}},{status:401});
    if(url.endsWith('/models'))return Response.json({data:[{id:'fixture-text',architecture:{output_modalities:['text']},supported_parameters:['tools']},{id:'fixture-image',architecture:{output_modalities:['image']}}]});
    const body=JSON.parse(options.body),fn=body.tools?.[0]?.function;
    return Response.json({id:key,choices:[{message:{tool_calls:[{type:'function',function:{name:fn?.name||'declare_trump',arguments:'{"choice":"pass"}'}}]}}],usage:{prompt_tokens:10,completion_tokens:4}});
  }});}
  async fetch(request){
    if(new URL(request.url).pathname==='/api/fixture-private-checkpoint'){
      await this.ready;this.session.save(false);return Response.json({ok:true});
    }
    return super.fetch(request);
  }
}

// Native local runtime, synthetic provider only. No model endpoint is called.
export class FixtureBroker extends SponsoredAI {
  fetch(request){
    return sponsoredRequest(request,this.env,this.ctx.storage,async(_url,options)=>{
      const body=JSON.parse(options.body),fn=body.tools?.[0]?.function;
      const props=fn?.parameters?.properties||{};
      const args=props.choice?{choice:'pass'}:props.accept?{accept:false}:props.move_id?{move_id:props.move_id.enum?.[0]||0}:{card_ids:[]};
      return Response.json({id:this.env.SPONSOR_ALIBABA_API_KEY,choices:[{message:{tool_calls:[{id:'fixture',type:'function',function:{name:fn?.name||'fixture',arguments:JSON.stringify(args)}}]}}],usage:{prompt_tokens:10,completion_tokens:4}});
    });
  }
}
export default worker;
