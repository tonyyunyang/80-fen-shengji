import test from 'node:test';
import assert from 'node:assert/strict';
import {createTableMusic, MUSIC_TRACK} from '../public/table-music.js';
import {readPreferences} from '../public/preferences.js';

function setup(fetchImpl = async () => ({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)})) {
  const preferences={music:false,musicVolume:30},doc={hidden:false},sources=[];
  const param=()=>({value:0,setTargetAtTime(value){this.value=value;}});
  const node=()=>({connect(){},disconnect(){},gain:param(),frequency:param(),Q:param()});
  const context={state:'running',currentTime:0,destination:{},decodeAudioData:async()=>({duration:MUSIC_TRACK.seconds}),createGain:node,createBiquadFilter:node,
    createBufferSource(){const n={...node(),start(_when,offset){this.offset=offset;},stop(){this.stopped=true;this.onended?.();}};sources.push(n);return n;}};
  let calls=0;const statuses=[];
  const music=createTableMusic(()=>preferences,{getContext:()=>context,document:doc,fetchImpl:(...args)=>{calls++;return fetchImpl(...args);},onStatus:s=>statuses.push(s)});
  return {preferences,doc,context,sources,music,statuses,calls:()=>calls};
}
test('music stays opt-in and never loads while muted or before audio is unlocked',async()=>{
  const f=setup();await f.music.sync();assert.equal(f.calls(),0);
  f.preferences.music=true;f.context.state='suspended';await f.music.sync();assert.equal(f.calls(),0);assert.equal(f.music.state(),'waiting');
  f.context.state='running';f.preferences.musicVolume=0;await f.music.sync();assert.equal(f.calls(),0);
});
test('one local music buffer loops and resumes at its previous position',async()=>{
  const f=setup();f.preferences.music=true;await f.music.sync();
  assert.equal(f.calls(),1);assert.equal(f.sources.length,1);assert.equal(f.sources[0].loop,true);
  for(let i=0;i<20;i++)f.music.update({muffled:i%2===0});assert.equal(f.sources.length,1);
  f.context.currentTime=16;f.doc.hidden=true;await f.music.sync();assert.equal(f.sources[0].stopped,true);
  f.context.currentTime=66;f.doc.hidden=false;await f.music.sync();assert.equal(f.sources[1].offset,16);assert.equal(f.calls(),1);
  f.preferences.music=false;await f.music.sync();assert.equal(f.sources[1].stopped,true);
});
test('turning music off during decode cannot start a late source',async()=>{
  let decoded;const f=setup();f.context.decodeAudioData=()=>new Promise(resolve=>decoded=resolve);
  f.preferences.music=true;const loading=f.music.sync();
  while(!decoded)await Promise.resolve();f.preferences.music=false;await f.music.sync();decoded({duration:MUSIC_TRACK.seconds});await loading;
  assert.equal(f.sources.length,0);assert.equal(f.music.state(),'off');
});
test('a failed music download is contained and can be retried explicitly',async()=>{
  let broken=true;const f=setup(async()=>{if(broken)throw new Error('offline');return{ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};});
  f.preferences.music=true;await f.music.sync();assert.equal(f.music.state(),'unavailable');await f.music.sync();assert.equal(f.calls(),1);
  broken=false;await f.music.sync({retry:true});assert.equal(f.music.state(),'playing');assert.equal(f.sources.length,1);
});
test('old preferences retain their effects choice and gain a separately muted music setting',()=>{
  assert.deepEqual({music:readPreferences({sound:true,volume:42}).music,musicVolume:readPreferences({}).musicVolume},{music:false,musicVolume:30});
  assert.equal(readPreferences({musicVolume:Infinity}).musicVolume,30);assert.equal(readPreferences({musicVolume:1000}).musicVolume,100);
});
