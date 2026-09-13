import worker from '../../cloudflare/free-worker.js';
import { SponsoredAI } from '../../cloudflare/sponsored-object.js';
import { sponsoredRequest } from '../../cloudflare/sponsor-core.js';
import { GameTable as AuthoritativeTable } from '../../cloudflare/game-table.js';
import {publicProviderFetch,publicAnswers} from '../../cloudflare/public-provider-fetch.js';
import {createGame,drawCard,applyBid,applyAction,safeAction,observation} from '../../src/game.js';
import {decodedReplay} from '../../cloudflare/result-record.js';
import {replayTimeline} from '../../cloudflare/completed-replay.js';

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
    if(new URL(request.url).pathname==='/api/fixture-cooperation'){
      await this.ready;this.session.stop();let state=this.session.state;
      for(let i=0;i<500&&!['lead','follow'].includes(state.pending?.phase);i++){
        const d=state.pending;state=applyAction(state,{seat:d.seat,version:d.version,decisionId:d.id,action:safeAction(observation(state,d.seat)),source:'peilian'});
      }
      this.session.state=state;this.session.config.limits.maxRequests=this.session.stats.realRequests+4;
      const schedule=this.session.schedule;this.session.schedule=()=>{};this.session.paused=false;
      try{for(let i=0;i<4;i++)await this.session.step();}
      finally{this.session.paused=true;this.session.schedule=schedule;this.session.save();}
      return Response.json({requests:this.auditRows.filter(row=>row.type==='request'&&['lead','follow'].includes(row.phase)).map(row=>({phase:row.phase,outcome:row.outcome,contextVersion:row.metering?.contextVersion,analysisStatus:row.metering?.analysisStatus})),fallbacks:this.session.stats.fallbacks});
    }
    if(new URL(request.url).pathname==='/api/fixture-dealing'){
      await this.ready;const input=await request.json();
      if(input.reset){
        this.session.start({seats:Array.from({length:4},(_,i)=>({kind:i===0?'human':'peilian'})),dealing:'continuous',rules:{firstDealer:'random'},limits:{maxRequests:0}});
        this.session.stop();
        this.session.state=createGame({...this.session.config,id:this.session.state.id,seed:18});
      }
      let state=this.session.state;
      for(let i=0;i<Math.min(100,Math.max(0,input.draws||0))&&state.dealt<100;i++)state=drawCard(state);
      if(input.bid){const seat=input.bid==='north-single'?2:0,choice=seat===2?'C1':'S2';state=applyBid(state,{gameId:state.id,epoch:state.attempts,seat,handCount:state.hands[seat].length,choice});}
      this.session.state=state;this.session.paused=false;this.session.bidding.ensure();
      if(input.draws)this.session.bidding.lastDrawAt=Date.now();
      this.session.save();return Response.json({dealt:state.dealt});
    }
    if(new URL(request.url).pathname==='/api/fixture-hand'){
      await this.ready;
      this.session.start({seats:Array.from({length:4},(_,i)=>({kind:i===0?'human':'peilian'})),dealing:'ordered',rules:{firstDealer:'random'},speed:50});
      this.session.stop();let state=createGame({...this.session.config,id:this.session.state.id,seed:4});
      while(state.pending.phase!=='bury'){
        const d=state.pending;state=applyAction(state,{seat:d.seat,version:state.version,decisionId:d.id,action:safeAction(observation(state,d.seat)),source:'peilian'});
      }
      this.session.state=state;this.session.save();return Response.json({ok:true});
    }
    if(new URL(request.url).pathname==='/api/fixture-complete'){
      await this.ready;this.session.stop();let state=this.session.state;
      for(let i=0;i<500&&!state.score;i++){const d=state.pending;state=applyAction(state,{seat:d.seat,version:state.version,decisionId:d.id,action:safeAction(observation(state,d.seat)),source:'peilian'});}
      if(!state.score)throw new Error('Fixture did not complete');
      this.session.state=state;this.session.paused=true;this.session.save();await this.drainResults();
      const rows=await this.env.GAME_RESULTS.prepare('SELECT result_id,winning_team,ip_address,replay_json FROM completed_games WHERE game_id = ?').bind(state.id).all();
      return Response.json({...rows,results:rows.results.map(({replay_json,...row})=>{
        const replay=decodedReplay(replay_json),frames=replayTimeline(replay);
        return {...row,replayVersion:replay.version,initialHandSizes:replay.deal.hands.map(hand=>hand.length),replayedScore:frames.at(-1).score.total};
      })});
    }
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
      const props=fn?.parameters?.properties||{},view=JSON.parse(body.messages[1].content);
      if(['lead','follow'].includes(view.phase)&&(!view.cooperation||!view.partnershipRead||view.v!==21))throw new Error('Expected partnership reading in the hosted card-play request');
      const args=props.choice?{choice:'pass'}:props.accept?{accept:false}:props.move_id?{move_id:props.move_id.enum?.[0]||0}:{card_ids:view.phase==='lead'?[view.hand[0][0]]:[]};
      return Response.json({id:this.env.SPONSOR_ALIBABA_API_KEY,choices:[{message:{tool_calls:[{id:'fixture',type:'function',function:{name:fn?.name||'fixture',arguments:JSON.stringify(args)}}]}}],usage:{prompt_tokens:10,completion_tokens:4}});
    });
  }
}
export default worker;
