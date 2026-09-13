import test from 'node:test';
import assert from 'node:assert/strict';
import {createTableMusic, MUSIC_TRACK} from '../public/table-music.js';
import {readPreferences} from '../public/preferences.js';

function setup(fetchImpl = async () => ({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)})) {
  const preferences={music:false,musicVolume:30},doc={hidden:false},sources=[],params=[];
  const param=()=>{const p={value:0,events:[],setTargetAtTime(value,at,tau){this.events.push(['target',value,at,tau]);this.value=value;},
    cancelScheduledValues(at){this.events.push(['cancel',at]);},setValueAtTime(value,at){this.events.push(['set',value,at]);this.value=value;},
    linearRampToValueAtTime(value,at){this.events.push(['ramp',value,at]);this.value=value;}};params.push(p);return p;};
  const node=()=>({connect(){},disconnect(){},gain:param(),frequency:param(),Q:param()});
  const context={state:'running',currentTime:0,destination:{},decodeAudioData:async()=>({duration:MUSIC_TRACK.seconds}),createGain:node,createBiquadFilter:node,
    createBufferSource(){const n={...node(),start(_when,offset){this.offset=offset;},stop(){this.stopped=true;this.onended?.();}};sources.push(n);return n;}};
  let calls=0;const statuses=[];
  const music=createTableMusic(()=>preferences,{getContext:()=>context,document:doc,fetchImpl:(...args)=>{calls++;return fetchImpl(...args);},onStatus:s=>statuses.push(s)});
  return {preferences,doc,context,sources,music,statuses,params,calls:()=>calls};
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
test('sound accents duck only the music bus and return smoothly without restarting the track',async()=>{
  const f=setup();f.preferences.music=true;await f.music.sync();
  f.context.currentTime=1;f.music.duck('play');
  const bus=f.params.find(p=>p.events.some(e=>e[0]==='ramp'));
  assert.ok(bus.events.some(e=>e[0]==='ramp'&&e[1]<.7&&e[2]>1));
  assert.ok(bus.events.some(e=>e[0]==='target'&&e[1]===1&&e[2]>1.1));
  const events=structuredClone(bus.events);
  for(let i=0;i<5;i++)f.music.update({muffled:false});
  assert.deepEqual(bus.events,events,'ordinary repaints must not reset the accent envelope');
  f.context.currentTime=1.05;f.music.duck('deal');
  assert.ok(bus.events.filter(e=>e[0]==='ramp').every(e=>e[1]<=.64),'a new quiet tap must not interrupt a stronger accent');
  assert.equal(f.sources.length,1);assert.equal(f.calls(),1);
  f.preferences.music=false;await f.music.sync();assert.equal(bus.value,1);
  assert.equal(readPreferences({volume:35}).volume,35,'explicit saved volumes are retained');
  assert.equal(readPreferences({}).volume,50);
});
