/* Playwright CLI against the local fixture Worker on 8236; no real providers.
   Replace __ARTIFACTS__ with an absolute ignored output/playwright path. */
async page => {
  const errors=[],actions=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith('/api/action'))actions.push(r.postDataJSON());});
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  await page.addInitScript(()=>sessionStorage.setItem('eighty-screen','menu'));
  await page.goto('http://127.0.0.1:8236');await page.getByRole('button',{name:'新游戏',exact:true}).waitFor();
  const token=await page.evaluate(()=>fetch('/api/state?seat=0').then(r=>r.json()).then(v=>v.csrf));
  const post=(path,body={})=>page.evaluate(async({path,body,token})=>{
    const r=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json','x-eighty-csrf':token},body:JSON.stringify(body)});
    if(!r.ok)throw new Error(await r.text());return r.json();
  },{path,body,token});
  const menu=async()=>{if(await page.locator('#gameView').isVisible()){
    await page.getByRole('button',{name:'☰ 菜单',exact:true}).click();await page.getByRole('button',{name:'返回主菜单',exact:true}).click();
  }};
  const pulse=body=>post('fixture-dealing',body),poses=[];
  const pose=number=>page.locator('.deal-flight[data-flight-key$=":'+number+'"]').evaluate(n=>({from:n.dataset.from,to:n.dataset.to,start:n.getAnimations()[0].startTime}));
  for(const size of [{width:1440,height:1000},{width:390,height:844},{width:844,height:390}]){
    await menu();await page.setViewportSize(size);await pulse({reset:true,draws:39});
    await page.getByRole('button',{name:'继续游戏',exact:true}).click();
    // Entering the full-height phone table can emit a visualViewport resize.
    // Let that settle before issuing the manually accelerated fixture draw.
    await page.waitForTimeout(150);
    await pulse({draws:1});await page.waitForTimeout(30);const first=await pose(40);
    const destination=JSON.parse(first.to);check(destination.x>10&&destination.y>10&&destination.x<size.width&&destination.y<size.height,'flight must land at a visible seat');
    await pulse({bid:'north-single'});const after=await pose(40);
    check(JSON.stringify(first)===JSON.stringify(after),'single declaration retargeted/restarted the in-flight card');
    await pulse({draws:32});await page.waitForTimeout(30);const pair=await pose(72);
    await pulse({bid:'south-pair'});check(JSON.stringify(pair)===JSON.stringify(await pose(72)),'pair declaration retargeted/restarted the flight');
    check(await page.locator('.declaration-pile').count()===2,'both public declarations remain visible');
    await page.waitForTimeout(350);await pulse({draws:1});await page.waitForTimeout(190);await pulse({draws:1});
    check(await page.locator('.deal-flight').count()===2,'the next draw replaced the previous flight');
    for(let i=0;i<8;i++)await pulse({draws:1});
    check(await page.locator('.deal-flight').count()<=4,'unbounded flight queue');
    await page.waitForTimeout(370);check(await page.locator('.deal-flight').count()===0,'completed flights did not clean up');
    await page.screenshot({path:__ARTIFACTS__+'/declarations-'+size.width+'.png'});
    await pulse({draws:1});await page.setViewportSize({width:size.width+1,height:size.height});await page.waitForTimeout(80);
    check(await page.locator('.deal-flight').count()===0,'resize must cancel old screen-space flights');
    poses.push({width:size.width,frozenSingle:true,frozenPair:true,overlappingFlights:true});
  }
  for(const size of [{width:1440,height:1000},{width:390,height:844}]){
    await menu();await page.setViewportSize(size);await post('fixture-hand');await page.getByRole('button',{name:'继续游戏',exact:true}).click();
    await page.getByRole('button',{name:'帮选',exact:true}).click();await page.getByRole('button',{name:'确认扣底 ↵',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.hand-slot').length===25);
    const initial=actions.length,card=page.locator('.hand-slot').first();await card.scrollIntoViewIfNeeded();
    const box=await card.boundingBox(),x=box.x+12,y=box.y+box.height-50;
    await page.mouse.move(x,y);await page.waitForTimeout(80);await page.mouse.down();await page.mouse.move(x,y-12,{steps:3});await page.mouse.up();
    await page.waitForTimeout(300);check(actions.length===initial,'small wobble submitted a card');
    await card.focus();await page.keyboard.press('Space');
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-60,{steps:6});
    check(await page.locator('.drag-ghost').getAttribute('data-over')==='true','short lift on the left felt edge was not recognized');
    check(await page.locator('#dropTarget').evaluate(n=>parseFloat(getComputedStyle(n).borderTopWidth))===0,'rigid target border remains');
    await page.mouse.move(x,y,{steps:6});await page.mouse.up();await page.waitForTimeout(300);
    check(actions.length===initial&&await card.getAttribute('aria-pressed')==='true','returning to hand must cancel and keep selection');
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-60,{steps:6});await page.mouse.up();
    await page.waitForFunction(()=>document.querySelectorAll('.hand-slot').length===24);
    check(actions.length===initial+1,'shallow lift must play exactly once');
    await page.screenshot({path:__ARTIFACTS__+'/natural-play-'+size.width+'.png'});
  }
  await menu();check(errors.length===0,errors.join('\n'));
  return {poses,naturalLift:true,returnCancels:true,oneSubmission:true,consoleErrors:0};
}
