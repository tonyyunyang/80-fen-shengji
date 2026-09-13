/* Playwright CLI against the synthetic Worker on 8236. Replace __ARTIFACTS__
   with an absolute ignored output/playwright directory. No live providers. */
async page=>{
  const errors=[],actions=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith('/api/action'))actions.push(r.postDataJSON());});
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  await page.addInitScript(()=>sessionStorage.setItem('eighty-screen','menu'));
  await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:8236/?qa');
  await page.getByRole('button',{name:'新游戏',exact:true}).waitFor();
  const token=await page.evaluate(()=>fetch('/api/state?seat=0').then(r=>r.json()).then(s=>s.csrf));
  const post=(path,body={})=>page.evaluate(async({path,body,token})=>{
    const r=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json','x-eighty-csrf':token},body:JSON.stringify(body)});
    if(!r.ok)throw new Error('Fixture request failed: '+path);return r.json();
  },{path,body,token});
  await post('fixture-hand');await page.getByRole('button',{name:'继续游戏',exact:true}).click();
  const slots=page.locator('.hand-slot'),selected=page.locator('.hand-slot[aria-pressed=true]');
  await slots.nth(12).press('Space');await page.mouse.move(20,20);await page.waitForTimeout(550);
  const id=await selected.getAttribute('data-card'),chosen=page.locator('.hand-slot[data-card="'+id+'"]');
  const rect=await chosen.boundingBox(),poses=[];
  for(const direction of [1,-1]){
    const xs=Array.from({length:42},(_,i)=>rect.x-100+i*7);if(direction<0)xs.reverse();
    for(const x of xs){await page.mouse.move(x,rect.y+rect.height*.7);await page.waitForTimeout(12);
      poses.push(await chosen.locator('.lift').evaluate(n=>{const m=new DOMMatrixReadOnly(getComputedStyle(n).transform);return {y:m.m42,angle:Math.atan2(m.b,m.a)};}));}
  }
  const variation=Math.max(...poses.map(p=>p.y))-Math.min(...poses.map(p=>p.y));
  check(variation<.04&&poses.every(p=>Math.abs(p.angle)<.0001),'selected card joined the hover wave or tilt');
  check(await chosen.locator('.face').evaluate(n=>getComputedStyle(n).animationName)==='none','selected face still idly bobs');
  await page.mouse.move(20,20);await page.waitForTimeout(350);
  const target=await page.evaluate(id=>window.__handHover.restingRect(Number(id)),id);
  check(Number.isFinite(target.top)&&Number.isFinite(target.left),'responsive selected return target is not finite');
  const raised=await chosen.locator('.face').boundingBox();
  const bodyPoint={x:raised.x+raised.width*.55,y:raised.y+raised.height*.65};
  check(await page.evaluate(p=>window.__handHover.pick(p.x,p.y)?.id,bodyPoint)===Number(id),'the visible selected body targets a neighbour');
  await page.mouse.click(raised.x+12,raised.y+12);check(await chosen.getAttribute('aria-pressed')==='false','exposed selected strip cannot be clicked directly');
  // The second contact must still toggle the same card after selection has
  // lifted its lower edge away from that stationary contact point.
  for(const fraction of [.65,.76]){
    await page.mouse.move(10,10);await page.waitForTimeout(350);
    const slot=await chosen.boundingBox();await page.mouse.move(slot.x+8,slot.y+slot.height*.7);await page.waitForTimeout(200);
    const face=await chosen.locator('.face').boundingBox(),point={x:face.x+face.width*.55,y:slot.y+slot.height*fraction};
    await page.mouse.move(point.x,point.y);await page.waitForTimeout(100);
    for(const gap of [30,220]){
      await page.mouse.click(point.x,point.y);await page.waitForTimeout(gap);
      check(await page.locator('#playerHand').getAttribute('data-hovered-card')===id,'click collapsed the reading gap');
      await page.mouse.click(point.x,point.y);check(await selected.count()===0,'stationary click switched card identities');
    }
  }
  await page.mouse.move(10,10);await page.waitForTimeout(350);
  const handIds=await slots.evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.card))),pairId=handIds.find(id=>id<54&&handIds.includes(id+54));
  const paired=page.locator('.hand-slot[data-card="'+pairId+'"]'),pairSlot=await paired.boundingBox();
  await page.mouse.move(pairSlot.x+8,pairSlot.y+pairSlot.height*.7);await page.waitForTimeout(200);
  const pairFace=await paired.locator('.face').boundingBox();await page.mouse.move(pairFace.x+pairFace.width*.6,pairSlot.y+pairSlot.height*.7);await page.waitForTimeout(100);
  await page.mouse.dblclick(pairFace.x+pairFace.width*.6,pairSlot.y+pairSlot.height*.7);
  const pairIds=await selected.evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.card)).sort((a,b)=>a-b));
  check(JSON.stringify(pairIds)===JSON.stringify([pairId,pairId+54]),'double click selected the underlying slot instead of the visible pair');
  await page.getByRole('button',{name:'清空',exact:true}).click();
  for(const index of [9,12,15])await slots.nth(index).press('Space');
  await page.mouse.move(20,20);await page.waitForTimeout(550);
  const ids=await selected.evaluateAll(nodes=>nodes.map(n=>n.dataset.card));
  const from=await selected.first().locator('.face').boundingBox();
  await page.mouse.move(from.x+12,from.y+12);await page.mouse.down();
  await page.mouse.move(from.x+42,from.y-30,{steps:8});
  check(await page.locator('.drag-card').count()===3,'drag did not carry the entire selection');
  await page.mouse.move(from.x+25,rect.y+rect.height*.65,{steps:8});await page.mouse.up();
  const transforms=await page.locator('.drag-card').evaluateAll(nodes=>nodes.map(n=>n.style.transform));
  check(transforms.every(t=>!t.includes('NaN')),'cancelled drag has invalid target transforms');
  await page.waitForTimeout(380);check(await page.locator('.drag-ghost').count()===0,'return ghost did not settle');
  check(JSON.stringify(await selected.evaluateAll(nodes=>nodes.map(n=>n.dataset.card)))===JSON.stringify(ids),'cancelled drag changed selection');
  check(actions.length===0,'selection/return submitted cards');
  await page.screenshot({path:__ARTIFACTS__+'/selected-desktop.png'});
  // Freeze only the test's return animation, then re-grab its front card.
  // The other cards must finish their original return independently.
  const regrabFrom=await selected.first().locator('.face').boundingBox();
  await page.mouse.move(regrabFrom.x+12,regrabFrom.y+12);await page.mouse.down();await page.mouse.move(regrabFrom.x+60,regrabFrom.y-60,{steps:6});
  await page.keyboard.press('Escape');await page.mouse.up();
  await page.locator('.drag-ghost[data-returning=true]').evaluate(n=>{for(const a of n.getAnimations({subtree:true})){a.pause();a.currentTime=120;}});
  await page.getByRole('button',{name:'清空',exact:true}).click();
  const returning=page.locator('.drag-ghost[data-returning=true] .drag-card').last(),returningId=await returning.getAttribute('data-card-id'),returnRect=await returning.boundingBox();
  await page.mouse.move(returnRect.x+returnRect.width*.6,returnRect.y+returnRect.height*.6);await page.mouse.down();
  await page.mouse.move(returnRect.x+returnRect.width*.6+15,returnRect.y+returnRect.height*.6-25,{steps:4});
  check(await page.locator('.drag-ghost:not([data-returning=true]) .drag-card').getAttribute('data-card-id')===returningId,'re-grab chose a slot beneath the returning card');
  check(await page.locator('.drag-ghost[data-returning=true] .drag-card').count()===2,'re-grab removed unrelated returning cards');
  await page.locator('.drag-ghost[data-returning=true]').evaluate(n=>{for(const a of n.getAnimations({subtree:true}))a.finish();});
  check(await page.locator('.hand-slot[data-card="'+returningId+'"]').evaluate(n=>n.classList.contains('is-drag-source')),'old return revealed the newly held card');
  await page.keyboard.press('Escape');await page.mouse.up();await page.waitForTimeout(500);
  check(await page.locator('.drag-ghost').count()===0,'re-grab left a ghost behind');
  for(const index of [9,12,15])await slots.nth(index).press('Space');await page.mouse.move(10,10);await page.waitForTimeout(500);
  const screens=[];
  for(const size of [{width:390,height:844},{width:844,height:390},{width:320,height:568}]){
    await page.setViewportSize(size);await selected.first().scrollIntoViewIfNeeded();await page.mouse.move(2,2);await page.waitForTimeout(500);
    const hand=await page.locator('#playerHand').boundingBox(),face=await selected.first().locator('.face').boundingBox();
    check(face.y>=hand.y-1,'selected card clipped above the hand on '+size.width+'x'+size.height);
    const position=await page.evaluate(()=>window.__handHover.restingRect(Number(document.querySelector('.hand-slot[aria-pressed=true]').dataset.card)));
    check(Number.isFinite(position.top),'mobile return target invalid');screens.push({...size,selectedLift:await selected.first().locator('.lift').evaluate(n=>new DOMMatrixReadOnly(getComputedStyle(n).transform).m42)});
    await page.screenshot({path:__ARTIFACTS__+'/selected-'+size.width+'x'+size.height+'.png'});
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'清空',exact:true}).click();
  await slots.nth(3).press('Space');await page.waitForTimeout(70);
  check(await selected.count()===1,'reduced-motion selection failed');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setViewportSize({width:1440,height:1000});
  await post('fixture-dealing',{reset:true,draws:40});await post('fixture-dealing',{bid:'north-single'});
  await post('fixture-dealing',{draws:32});await post('fixture-dealing',{bid:'south-pair'});
  await page.locator('#bookButton').click();await page.locator('[data-book-tab=history]').click();
  const history=await page.locator('#history').innerText();
  check(history.includes('单张 ♣2')&&history.includes('双张 ♠2 ♠2'),'history lost the exposed declaration cards');
  await page.screenshot({path:__ARTIFACTS__+'/declaration-history.png'});await page.locator('#closeBook').click();
  await post('pause',{paused:true});
  check(errors.length===0,errors.join('\n'));
  return {selectedSweepVariation:variation,selectedReturnTarget:target,raisedBodyClick:true,stationaryClicks:true,doubleClickPair:true,groupReturn:true,partialRegrab:true,screens,declarationHistory:true,consoleErrors:errors.length,liveModelCalls:0};
}
