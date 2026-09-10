// Reproducible screenshots of the real game, never an alternate renderer.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { cardPlayFixture } from './paired-eval.mjs';
import { Session, validateConfig } from '../server/session.js';
import { groups } from '../src/rules.js';

const port=Number(process.env.MEDIA_PORT||5191);
if(!Number.isInteger(port)||port<1024||port>65535||port===5173)throw new Error('Choose a separate MEDIA_PORT between 1024 and 65535.');
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'output/media-preview');
await mkdir(directory+'/browser-sessions',{recursive:true,mode:0o700});
let state;
for(let seed=1;seed<1000;seed++){
  const candidate=cardPlayFixture(seed);
  if(candidate.dealer===0&&groups(candidate.hands[0]).some(g=>g.length===2)){state=candidate;break;}
}
if(!state)throw new Error('No suitable real-engine fixture');
const config=validateConfig({seats:[{kind:'human',name:'你'},...['东家','北家','西家'].map(name=>({kind:'peilian',name}))],limits:{maxRequests:0},speed:650});
state.seats=config.seats;
let saved;const session=new Session({env:{},persist:data=>saved=data});
session.config=config;session.state=state;session.paused=true;session.save();session.stop();
const cookie=randomBytes(32).toString('hex'),hash=createHash('sha256').update(cookie).digest('hex');
await writeFile(directory+'/browser-sessions/'+hash+'.json',JSON.stringify(saved),{mode:0o600});
await writeFile(directory+'/fixture.json',JSON.stringify({url:'http://127.0.0.1:'+port,cookieName:'eighty_'+port,cookie,hand:state.hands[0],pair:groups(state.hands[0]).find(g=>g.length===2).map(c=>c.id)},null,2),{mode:0o600});
if(process.argv.includes('--fixture-only')){console.log('Fresh media fixture written.');process.exit(0);}
const child=spawn(process.execPath,['server/index.js'],{cwd:root,env:{HOST:'127.0.0.1',PORT:String(port),EIGHTY_DATA_DIR:directory},stdio:['ignore','inherit','inherit']});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill('SIGTERM'));
child.on('exit',code=>process.exit(code||0));
console.log('Media fixture ready in output/media-preview/fixture.json; API budget is zero.');
