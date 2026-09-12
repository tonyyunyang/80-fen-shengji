import {completedResult,RESULT_COLUMNS,RESULT_INSERT,resultRetentionDays,encodedReplay} from './result-record.js';

// The durable local outbox survives page closure, a new deal and D1 outages.
// D1 receives only terminal results; inserts and receipts are idempotent.
export class ResultArchive {
  constructor(ctx,env){
    this.ctx=ctx;this.env=env;this.db=env.GAME_RESULTS;this.enabled=env.RESULTS_ENABLED==='true'&&!!this.db;this.flushing=null;
    if(this.db){
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS result_outbox (result_id TEXT PRIMARY KEY, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL)');
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS result_receipts (result_id TEXT PRIMARY KEY)');
    }
  }
  enqueue(state,identity){
    if(!this.enabled)return false;
    const record=completedResult(state,{...identity,secret:this.env.EIGHTY_GATEWAY_SECRET});if(!record)return false;
    const sql=this.ctx.storage.sql;
    if([...sql.exec('SELECT result_id FROM result_receipts WHERE result_id = ? UNION ALL SELECT result_id FROM result_outbox WHERE result_id = ? LIMIT 1',record.result_id,record.result_id)].length)return false;
    sql.exec('INSERT INTO result_outbox(result_id,payload,next_at) VALUES(?,?,?)',record.result_id,JSON.stringify(record),Date.now());return true;
  }
  nextDue(){return this.db?[...this.ctx.storage.sql.exec('SELECT MIN(next_at) AS due FROM result_outbox')][0]?.due??null:null;}
  flush(){
    if(!this.db)return Promise.resolve();if(this.flushing)return this.flushing;
    this.flushing=this.drain().finally(()=>{this.flushing=null;});return this.flushing;
  }
  async drain(){
    const sql=this.ctx.storage.sql;
    const rows=[...sql.exec('SELECT result_id,payload,attempts FROM result_outbox WHERE next_at <= ? ORDER BY next_at LIMIT 10',Date.now())];
    for(const row of rows){
      try{
        const record=JSON.parse(row.payload),days=resultRetentionDays(this.env);
        if(days&&record.completed_at<Math.floor(Date.now()/1000)-days*86400&&record.ip_address!=='none'){
          record.ip_address='none';sql.exec('UPDATE result_outbox SET payload = ? WHERE result_id = ?',JSON.stringify(record),row.result_id);
        }
        const archived={...record,replay_json:encodedReplay(record.replay_json)};
        const result=await this.db.prepare(RESULT_INSERT).bind(...RESULT_COLUMNS.map(c=>archived[c])).run();
        if(result.success===false)throw new Error('Result insert failed');
        this.ctx.storage.transactionSync(()=>{
          sql.exec('INSERT OR IGNORE INTO result_receipts(result_id) VALUES(?)',row.result_id);
          sql.exec('DELETE FROM result_outbox WHERE result_id = ?',row.result_id);
        });
      }catch{
        const delay=Math.min(3600000,5000*2**Math.min(10,row.attempts));
        sql.exec('UPDATE result_outbox SET attempts = attempts + 1, next_at = ? WHERE result_id = ?',Date.now()+delay,row.result_id);
      }
    }
  }
}
export async function pruneResultIps(env,now=Date.now()){
  const days=resultRetentionDays(env);
  if(!env.GAME_RESULTS||!days)return;
  await env.GAME_RESULTS.prepare("UPDATE completed_games SET ip_address = 'none' WHERE ip_address <> 'none' AND completed_at < ?").bind(Math.floor(now/1000)-days*86400).run();
}
