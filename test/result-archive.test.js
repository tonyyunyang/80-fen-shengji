import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createGame,applyAction,safeAction,nextDeal,observation,drawCard,closeBidding,applyBid,publicView} from '../src/game.js';
import {replayTimeline} from '../cloudflare/completed-replay.js';
import {completedResult,visitorIp,encodedReplay,decodedReplay} from '../cloudflare/result-record.js';
import {ResultArchive,pruneResultIps} from '../cloudflare/result-archive.js';

const secret='fixture-result-signing-secret-not-a-real-key',ownerId='a'.repeat(64);
function finish(state){for(let i=0;i<500&&!state.score;i++){const d=state.pending;assert.ok(d);state=applyAction(state,{seat:d.seat,version:state.version,decisionId:d.id,action:safeAction(observation(state,d.seat)),source:'peilian'});}assert.ok(state.score);return state;}
const allAI=()=>Array.from({length:4},()=>({kind:'api',provider:'mock',model:'fixture-model',name:'private name'}));
const finished=finish(createGame({id:'archive-fixture',seed:80,seats:allAI()}));
const identity={ownerId,secret,ip:'93.184.216.34',now:Date.UTC(2026,8,12)};

test('only a terminal, completely played deal produces a result; AI-only winners are included',()=>{
  const record=completedResult(finished,identity);assert.ok(record);assert.equal(record.is_complete,1);
  assert.equal(record.winning_team,finished.score.attackersWin?1-finished.dealer%2:finished.dealer%2);
  for(const state of [{...finished,phase:'play'},{...finished,score:null},{...finished,hands:[[{}],[],[],[]]},{...finished,completedDealEpoch:0}])assert.equal(completedResult(state,identity),null);
  const humanLost=structuredClone(finished);humanLost.seats[(1-record.winning_team)]= {kind:'human',name:'private name'};
  assert.ok(completedResult(humanLost,identity),'the winner is recorded even when the human team lost');
});
test('records include only the completed epoch and safe metadata, with a separate anonymous user identity',()=>{
  const next=finish(nextDeal(finished));next.events.push({type:'private-fixture',deal:next.attempts,audience:0,secret:'do-not-export'});
  const record=completedResult(next,identity),text=JSON.stringify(record);
  assert.ok(JSON.parse(record.replay_json).events.every(e=>e.deal===next.completedDealEpoch));
  for(const value of ['do-not-export','private name',secret,'"seed"'])assert.equal(text.includes(value),false);
  assert.notEqual(record.user_id,ownerId);assert.equal(record.user_id,completedResult(finished,identity).user_id);
  assert.notEqual(record.result_id,completedResult(finished,identity).result_id);
});
test('only usable public IP addresses are stored, with none for unavailable or synthetic addresses',()=>{
  for(const value of [null,'none','invalid','127.0.0.1','10.0.0.1','::1','2a06:98c0:3600::103'])assert.equal(visitorIp(value),'none');
  assert.equal(visitorIp('93.184.216.34'),'93.184.216.34');assert.equal(visitorIp('2001:4860:4860::8888'),'2001:4860:4860::8888');
});
test('redealt attempts stay outside the completed replay',()=>{
  let state=createGame({seed:4,seats:allAI(),rules:{fullRebel:'scramble',pointRebelThreshold:1000}});
  while(state.pending&&!['lead','follow'].includes(state.pending.phase)){
    const d=state.pending,action=d.phase==='rebel'?{type:'rebel',accept:true}:safeAction(observation(state,d.seat));
    state=applyAction(state,{seat:d.seat,version:state.version,decisionId:d.id,action});
  }
  state=finish(state);assert.equal(state.attempts,4);
  const replay=decodedReplay(completedResult(state,identity).replay_json);
  assert.equal(replay.dealEpoch,4);assert.equal(replay.deal.draws.length,100);
  assert.ok(replay.events.every(event=>event.deal===4));assert.equal(replayTimeline(replay).at(-1).score.total,state.score.total);
});
test('completed replays are compressed without losing hands or events; legacy records remain readable',()=>{
  const record=completedResult(finished,identity),encoded=encodedReplay(record.replay_json);
  assert.deepEqual(decodedReplay(encoded),JSON.parse(record.replay_json));
  assert.ok(Buffer.byteLength(encoded)<Buffer.byteLength(record.replay_json)/2);
  const legacy=JSON.stringify(JSON.parse(record.replay_json).events);
  assert.deepEqual(decodedReplay(encodedReplay(legacy)),JSON.parse(legacy));
  assert.throws(()=>replayTimeline(decodedReplay(legacy)),/legacy/);
});

test('private archive replays every original hand, kitty pickup, play, capture and final score in both dealing modes',()=>{
  for(const dealing of ['ordered','continuous'])for(const seed of [1,17,80]){
    let state=createGame({seed,seats:allAI(),dealing});
    if(dealing==='continuous'){
      for(let i=0;i<100;i++){
        state=drawCard(state);
        const seat=state.drawSeat,view=observation(state,seat),option=view.options.find(o=>o.id!=='pass');
        if(option)state=applyBid(state,{gameId:state.id,epoch:state.attempts,seat,handCount:state.hands[seat].length,choice:option.id});
      }
      state=closeBidding(state);
    }
    let beforeBury;const afterPlays=[];
    while(!state.score){
      const d=state.pending;
      if(d.phase==='bury')beforeBury=structuredClone(state.hands);
      const action=safeAction(observation(state,d.seat));
      state=applyAction(state,{seat:d.seat,version:state.version,decisionId:d.id,action,source:'peilian'});
      if(action.type==='play')afterPlays.push(structuredClone(state.hands));
      assert.equal('deal' in publicView(state,-1),false,'full recording never enters public observations');
    }
    const replay=decodedReplay(encodedReplay(completedResult(state,identity).replay_json)),frames=replayTimeline(replay);
    const sorted=hands=>hands.map(hand=>hand.map(card=>typeof card==='number'?card:card.id).sort((a,b)=>a-b));
    assert.deepEqual(sorted(frames.find(f=>f.stage==='kitty').hands),sorted(beforeBury));
    assert.deepEqual(frames.filter(f=>f.stage==='play').map(f=>sorted(f.hands)),afterPlays.map(sorted));
    assert.deepEqual(frames.at(-1).captured.map(h=>[...h].sort((a,b)=>a-b)),state.captured.map(h=>h.map(c=>c.id).sort((a,b)=>a-b)));
    assert.deepEqual(frames.at(-1).score,state.score);assert.deepEqual(frames.at(-1).trump,state.trump);
    assert.deepEqual(frames.at(-1).levels,state.match.levels);
    assert.ok(replay.deal.hands.every(hand=>hand.length===25));assert.equal(replay.deal.draws.length,100);
    const corrupt=structuredClone(replay);corrupt.deal.hands[0][0]=corrupt.deal.hands[1][0];
    assert.throws(()=>replayTimeline(corrupt),/physical deck/);
  }
});
function stores(){
  const local=new DatabaseSync(':memory:'),remote=new DatabaseSync(':memory:');remote.exec(readFileSync(new URL('../migrations/0001_completed_games.sql',import.meta.url),'utf8'));
  let fail=false,calls=0;
  const ctx={storage:{sql:{exec(sql,...values){const stmt=local.prepare(sql);return /^SELECT/i.test(sql)?stmt.all(...values):(stmt.run(...values),[]);}},transactionSync(fn){local.exec('BEGIN');try{const value=fn();local.exec('COMMIT');return value;}catch(e){local.exec('ROLLBACK');throw e;}}}};
  const db={prepare(sql){return {bind(...values){return {async run(){calls++;if(fail)throw new Error('synthetic outage');remote.prepare(sql).run(...values);return {success:true};}};}};}};
  const env={GAME_RESULTS:db,RESULTS_ENABLED:'true',RESULT_IP_RETENTION_DAYS:'30',EIGHTY_GATEWAY_SECRET:secret};
  return {ctx,env,local,remote,fail:value=>{fail=value;},calls:()=>calls};
}
test('outbox survives D1 failure and handler recreation; retries and repeated settlement do not duplicate rows',async()=>{
  const s=stores();let archive=new ResultArchive(s.ctx,s.env);
  assert.equal(archive.enqueue(finished,{ownerId,ip:identity.ip}),true);assert.equal(archive.enqueue(finished,{ownerId}),false);
  s.fail(true);await archive.flush();assert.equal(s.remote.prepare('SELECT COUNT(*) n FROM completed_games').get().n,0);assert.ok(archive.nextDue()>Date.now());
  archive=new ResultArchive(s.ctx,s.env);s.local.exec('UPDATE result_outbox SET next_at=0');s.fail(false);await archive.flush();
  assert.equal(s.remote.prepare('SELECT COUNT(*) n FROM completed_games').get().n,1);assert.equal(archive.nextDue(),null);assert.equal(archive.enqueue(finished,{ownerId}),false);
  assert.equal(s.local.prepare('SELECT COUNT(*) n FROM result_receipts').get().n,1);s.local.close();s.remote.close();
});
test('raw IP retention clears addresses while retaining complete game records',async()=>{
  const s=stores(),archive=new ResultArchive(s.ctx,s.env);archive.enqueue(finished,{ownerId,ip:identity.ip});await archive.flush();
  const before=s.remote.prepare('SELECT * FROM completed_games').get();assert.equal(before.ip_address,identity.ip);
  await pruneResultIps(s.env,Date.now()+31*86400000);const after=s.remote.prepare('SELECT * FROM completed_games').get();assert.equal(after.ip_address,'none');assert.equal(after.replay_json,before.replay_json);
  s.local.close();s.remote.close();
});
