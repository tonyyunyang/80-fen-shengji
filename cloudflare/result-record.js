import {createHmac} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import ipaddr from 'ipaddr.js';
import {publicView} from '../src/game.js';

export function visitorIp(value) {
  if(typeof value!=='string'||value.length>64||!ipaddr.isValid(value.trim()))return 'none';
  const address=ipaddr.process(value.trim());
  // Cloudflare uses this sentinel for cross-zone Worker subrequests, not an
  // actual visitor address. Private/local fixture addresses are not identities.
  if(address.range()!=='unicast'||address.toNormalizedString()==='2a06:98c0:3600:0:0:0:0:103')return 'none';
  return address.toString();
}
export const resultRetentionDays=env=>env.RESULT_IP_RETENTION_DAYS==='0'?0:30;
export function completedResult(state,{ownerId,secret,ip='none',now=Date.now()}={}) {
  if(!state?.score||!['round_over','match_over'].includes(state.phase)||!state.hands?.every(hand=>Array.isArray(hand)&&hand.length===0)||state.hands.length!==4||!state.tricks?.length)return null;
  const epoch=state.completedDealEpoch;
  if(!Number.isInteger(epoch)||epoch!==state.attempts||!state.events?.some(e=>e.type==='round_scored'&&e.deal===epoch)||typeof state.score.attackersWin!=='boolean')return null;
  if(!/^[a-f0-9]{64}$/.test(ownerId||'')||typeof secret!=='string'||secret.length<32)return null;
  const events=publicView(state,-1).events.filter(e=>e.deal===epoch);
  const sources={};
  for(const event of state.events.filter(e=>e.deal===epoch&&e.type==='decision_applied')){
    const source=['human','autoplay','peilian','api','simulated','mock','fallback','peilian-fallback','forced'].includes(event.source)?event.source:'other';sources[source]=(sources[source]||0)+1;
  }
  // Store the completed deal's public record, never the shuffle seed, future
  // deal, prompts, user-entered names, API credentials or private provider URLs.
  const replay=JSON.stringify(events);
  if(new TextEncoder().encode(replay).length>131072)throw new Error('Completed replay exceeds archive limit');
  return {
    result_id:state.id+':'+epoch,
    user_id:createHmac('sha256',secret).update('eighty-results-user\0'+ownerId).digest('hex'),
    game_id:state.id,deal_epoch:epoch,round_number:state.match.round,completed_at:Math.floor(now/1000),
    is_complete:1,winning_team:state.score.attackersWin?1-state.dealer%2:state.dealer%2,dealer:state.dealer,
    attackers_win:Number(state.score.attackersWin),final_attack_points:state.score.total,ruleset:state.ruleset,
    rules_json:JSON.stringify(state.rules),trump_json:JSON.stringify(state.trump),
    levels_before_json:JSON.stringify(events.find(e=>e.type==='deal_started')?.levels||[]),levels_after_json:JSON.stringify(state.match.levels),
    seats_json:JSON.stringify(state.seats.map(s=>({kind:s.kind,provider:s.kind==='api'?s.provider:null,model:s.kind==='api'?s.model:null}))),
    action_sources_json:JSON.stringify(sources),replay_json:replay,ip_address:visitorIp(ip),schema_version:1,
  };
}
export const RESULT_COLUMNS=['result_id','user_id','game_id','deal_epoch','round_number','completed_at','is_complete','winning_team','dealer','attackers_win','final_attack_points','ruleset','rules_json','trump_json','levels_before_json','levels_after_json','seats_json','action_sources_json','replay_json','ip_address','schema_version'];
export const RESULT_INSERT=`INSERT INTO completed_games (${RESULT_COLUMNS.join(',')}) VALUES (${RESULT_COLUMNS.map(()=>'?').join(',')}) ON CONFLICT DO NOTHING`;
export function encodedReplay(value){
  return JSON.stringify({encoding:'gzip+base64',bytes:Buffer.byteLength(value),events:JSON.parse(value).length,data:gzipSync(value,{level:6}).toString('base64')});
}
export function decodedReplay(value){
  const data=JSON.parse(value);if(Array.isArray(data))return data;
  if(data?.encoding!=='gzip+base64')throw new Error('Unsupported replay encoding');
  return JSON.parse(gunzipSync(Buffer.from(data.data,'base64'),{maxOutputLength:131072}).toString('utf8'));
}
