import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { buildEndgameEstimates } from './endgame-estimates.js';

const fields=['seat','hand','handSizes','trump','rules','plays','history','buriedKnown','declSeat','levels','played','round','firstTaker','curDecl','declarations','attackPoints','phase'];
let busy=false;
if (!isMainThread) {
  try { parentPort.postMessage({value:buildEndgameEstimates(workerData.view,workerData.moves,{maxHand:12,samples:workerData.samples||8}),status:'complete'}); }
  catch { parentPort.postMessage({value:null,status:'unavailable'}); }
}

// Keep sampled private work off the server event loop: another table may be
// continuously dealing. There is no unbounded queue and workers inherit no keys.
export function analyzeEndgame(view,moves,signal,{samples=8,maxMs=1200}={}) {
  if (!Number.isInteger(samples) || samples<1 || samples>32 || !Number.isFinite(maxMs) || maxMs<1 || maxMs>2500) throw new Error('Bounded analysis settings required');
  if (!view.trump || !['lead','follow'].includes(view.phase) || Math.max(...view.handSizes)>12 || view.hand.length<2) return Promise.resolve({value:null,status:'not_needed',ms:0});
  if (busy || signal?.aborted) return Promise.resolve({value:null,status:busy?'busy':'cancelled',ms:0});
  busy=true;
  const started=performance.now();
  return new Promise(resolve=>{
    let worker,timer,finished=false;
    const finish=result=>{
      if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      const done=()=>{busy=false;resolve({...result,ms:performance.now()-started});};
      if(worker)worker.terminate().then(done,done);else done();
    };
    const abort=()=>finish({value:null,status:'cancelled'});
    try {
      worker=new Worker(new URL(import.meta.url),{env:{},execArgv:[],workerData:{view:Object.fromEntries(fields.map(key=>[key,view[key]])),moves,samples}});
      worker.once('message',finish);
      worker.once('error',()=>finish({value:null,status:'unavailable'}));
      worker.once('exit',()=>finish({value:null,status:'unavailable'}));
      timer=setTimeout(()=>finish({value:null,status:'budget'}),maxMs);
      signal?.addEventListener('abort',abort,{once:true});
    } catch { finish({value:null,status:'unavailable'}); }
  });
}
