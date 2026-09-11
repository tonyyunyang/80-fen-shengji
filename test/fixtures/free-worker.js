import worker from '../../cloudflare/free-worker.js';
import { SponsoredAI } from '../../cloudflare/sponsored-object.js';
import { sponsoredRequest } from '../../cloudflare/sponsor-core.js';
import { GameTable as AuthoritativeTable } from '../../cloudflare/game-table.js';

// A fixture-only checkpoint trigger exercises the privacy boundary without
// relying on randomly dealt hands to happen to make a bot eligible to bid.
// The production entry exports AuthoritativeTable directly, without this route.
export class GameTable extends AuthoritativeTable {
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
