import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {requestAction,buildRequest} from '../src/providers.js';
import {classify,followError,resolveCards} from '../src/rules.js';
import {cooperationCases,matchesAccepted} from '../test/fixtures/cooperation-cases.mjs';

// No retries or practice fallback in the tactical score. Every failed attempt
// remains in the denominator. Pass only the evaluator's provider credentials.
export async function runCooperationEvaluation({live=false,env={},maxMs=8*60_000,call=requestAction,onProgress=async()=>{}}={}){
  if(!live)throw new Error('Tactical API evaluation requires explicit live opt-in');
  if(!env.QWEN_API_KEY||!env.QWEN_BASE_URL)throw new Error('Configure the evaluator provider locally');
  if(!Number.isFinite(maxMs)||maxMs<=0||maxMs>8*60_000)throw new Error('Tactical wall limit is eight minutes');
  const started=Date.now(),deadline=started+maxMs;
  const profiles=['expert-facts-zh','expert-cooperate-zh'];
  const report={version:1,model:'qwen3.8-max',profiles,startedAt:new Date(started).toISOString(),
    limits:{requests:48,wallMs:maxMs,decisionMs:12000,outputTokens:512,requestBytes:96000},
    design:'Twelve synthetic tactical positions, each rotated by two seats. Acceptable moves were written before model calls, separately from the cooperation scorer. Alternate profile order per position. No repair, fallback, secret hands, or whole-deal win-rate claim.',requests:[]};
  for(const [index,item] of cooperationCases().entries())for(const profile of index%2?[...profiles].reverse():profiles){
    if(Date.now()>=deadline||report.requests.length>=48)break;
    const row={case:item.id,profile,purpose:item.purpose,status:'pending',passed:false};
    report.requests.push(row);await onProgress(report);
    try{
      const seat={provider:'qwen',model:report.model},options={env,contextProfile:profile,maxOutput:512,thinking:false,
        signal:AbortSignal.timeout(Math.min(12000,Math.max(1,deadline-Date.now())))};
      if(Buffer.byteLength(JSON.stringify(buildRequest(item.view,seat,options).body))>report.limits.requestBytes)throw new Error('Request byte limit');
      const response=await call(item.view,seat,options);row.action=response.action;row.metering=response.metering;
      const cards=resolveCards(item.view.hand,response.action.cardIds);
      const error=followError(item.view.hand,cards,classify(item.view.plays[0].cards,item.view.trump),item.view.trump,item.view.rules);
      if(error)throw new Error('Illegal follow');
      row.status='valid';row.passed=matchesAccepted(item,response.action);
    }catch(error){row.status='failed';row.error=error.name;row.metering=error.metering||row.metering||null;}
    await onProgress(report);
  }
  report.summary=profiles.map(profile=>{const rows=report.requests.filter(r=>r.profile===profile);return {profile,attempts:rows.length,passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>r.status==='failed').length};});
  report.stopReason=report.requests.length===48?'schedule_complete':'wall_time_guard';
  report.finishedAt=new Date().toISOString();report.wallMs=Date.now()-started;await onProgress(report);return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv.includes('--live'))throw new Error('Use --live to explicitly opt into at most 48 requests');
  try{process.loadEnvFile('.env');}catch(error){if(error.code!=='ENOENT')throw error;}
  const env={QWEN_API_KEY:process.env.QWEN_API_KEY,QWEN_BASE_URL:process.env.QWEN_BASE_URL};
  await mkdir('output/cooperation',{recursive:true});const path='output/cooperation/tactical-'+Date.now()+'.json';
  const report=await runCooperationEvaluation({live:true,env,onProgress:r=>writeFile(path,JSON.stringify(r,null,2)+'\n',{mode:0o600})});
  console.log(JSON.stringify({path,summary:report.summary,stopReason:report.stopReason}));
}
