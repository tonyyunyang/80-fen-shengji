/* Run using the Playwright CLI against the isolated local preview on 8235.
   Replace __ARTIFACTS__ with an absolute ignored output/playwright directory. */
async page => {
  const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.addInitScript(()=>{
    if(window.__eightyAudioInstrumented)return;window.__eightyAudioInstrumented=true;
    const Native=window.AudioContext;window.__audioEvents=[];
    window.AudioContext=class extends Native {
      createBufferSource(){const node=super.createBufferSource(),start=node.start.bind(node),stop=node.stop.bind(node);node.start=(...args)=>{window.__audioEvents.push({type:node.buffer?.duration>80?'music':'paper',offset:args[1]||0,loop:node.loop});return start(...args);};node.stop=(...args)=>{if(node.buffer?.duration>80)window.__audioEvents.push({type:'music-stop'});return stop(...args);};return node;}
      createOscillator(){const node=super.createOscillator(),start=node.start.bind(node);node.start=(...args)=>{window.__audioEvents.push({type:'tone'});return start(...args);};return node;}
    };
  });
  const check=(value,message)=>{if(!value)throw new Error(message);};
  await page.goto('http://127.0.0.1:8235');await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'♪ 静音',exact:true}).waitFor();
  check(!requests.some(url=>url.endsWith('/after-eighty.mp3')),'music must not load before the first gesture');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('musicStatus').textContent.includes('正在播放'));
  check(await page.getByLabel('背景音乐',{exact:true}).isChecked()&&await page.getByLabel('牌桌音效',{exact:true}).isChecked(),'both audio defaults must be enabled');
  const starts=()=>page.evaluate(()=>window.__audioEvents.filter(e=>e.type==='music'));
  check((await starts()).length===1&&(await starts())[0].loop,'one looping music source');
  await page.getByLabel('音乐音量',{exact:true}).press('ArrowLeft');
  await page.getByRole('button',{name:'试听牌桌音效',exact:true}).click();
  await page.waitForTimeout(6600);
  const effects=await page.evaluate(()=>window.__audioEvents);
  check(effects.filter(e=>e.type==='paper').length>=6&&effects.filter(e=>e.type==='tone').length>=9,'the effect audition plays the paper and scoring palette');
  check((await starts()).length===1,'settings and volume changes must not restart the song');
  // This automation browser keeps background pages visible. Drive a controlled
  // visibility event to exercise the real browser AudioContext suspend/resume.
  await page.evaluate(()=>{window.__testHidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__testHidden});});
  await page.evaluate(()=>{window.__testHidden=true;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>document.getElementById('musicStatus').textContent.includes('已暂停'),null,{timeout:5000});
  await page.evaluate(()=>{window.__testHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>document.getElementById('musicStatus').textContent.includes('正在播放'),null,{timeout:5000});
  await page.evaluate(()=>{delete document.hidden;});
  const resumed=await starts();check(resumed.length===2&&resumed[1].offset>3,'hidden-tab resume must continue the track, not rewind it');
  check(requests.filter(url=>url.endsWith('/after-eighty.mp3')).length===1,'the decoded recording is reused');
  await page.getByLabel('背景音乐',{exact:true}).uncheck();await page.getByLabel('牌桌音效',{exact:true}).uncheck();
  check(!requests.some(url=>/\/api\/(start|action)$/.test(url)),'audio settings never call game or AI actions');
  await page.screenshot({path:__ARTIFACTS__+'/settings-wide.png'});
  await page.setViewportSize({width:390,height:844});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'settings must fit a narrow screen');
  check(await page.locator('#settingsView .option-row input, #settingsView .option-row select').evaluateAll(nodes=>nodes.every(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth;})),'every audio and display control must remain visible, not merely clipped by overflow');
  await page.screenshot({path:__ARTIFACTS__+'/settings-narrow.png',fullPage:true});
  await page.reload();await page.getByRole('button',{name:'♪ 开启声音',exact:true}).waitFor();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  check(!await page.getByLabel('背景音乐',{exact:true}).isChecked()&&!await page.getByLabel('牌桌音效',{exact:true}).isChecked(),'saved mutes must survive reload');
  check((await starts()).length===0,'saved mutes must not start audio on interaction');
  await page.locator('#resetPreferences').click();
  await page.waitForFunction(()=>document.getElementById('musicStatus').textContent.includes('正在播放'));
  check(await page.getByLabel('背景音乐',{exact:true}).isChecked()&&await page.getByLabel('牌桌音效',{exact:true}).isChecked(),'reset must restore both enabled defaults');
  await page.getByLabel('背景音乐',{exact:true}).uncheck();await page.getByLabel('牌桌音效',{exact:true}).uncheck();
  check(errors.length===0,errors.join('\n'));
  return {firstGestureStartsAudio:true,musicLoadedOncePerPage:true,loop:true,resumeOffset:resumed[1].offset,phaseEffects:effects.filter(e=>e.type!=='music').length,savedMuteRetained:true,resetEnablesAudio:true,consoleErrors:errors.length};
}
