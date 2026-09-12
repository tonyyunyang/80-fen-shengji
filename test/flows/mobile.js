/* Playwright CLI; use the local fixture Worker on 8236. No live models. */
async page => {
  const errors=[],actions=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().endsWith('/api/action'))actions.push(request.postDataJSON());});
  const check=(value,message)=>{if(!value)throw new Error(message);};
  const state=()=>page.evaluate(()=>fetch('/api/state?seat=0').then(r=>r.json()));
  const post=(path,body={})=>page.evaluate(async({path,body})=>{
    const view=await fetch('/api/state?seat=0').then(r=>r.json());
    const response=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json','x-eighty-csrf':view.csrf},body:JSON.stringify(body)});
    if(!response.ok)throw new Error('Fixture request failed: '+response.status);return response.json();
  },{path,body});
  await page.addInitScript(()=>sessionStorage.setItem('eighty-screen','menu'));
  await page.goto('http://127.0.0.1:8236');
  await page.getByRole('button',{name:'新游戏',exact:true}).waitFor();
  await post('fixture-hand');
  await page.getByRole('button',{name:'继续游戏',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.hand-slot').length===33);
  const sizes=[];
  for(const size of [{width:320,height:568},{width:375,height:667},{width:390,height:844},{width:844,height:390},{width:1440,height:1000}]){
    await page.setViewportSize(size);await page.waitForTimeout(200);
    const visible=await page.locator('#pauseGame,#bookButton,#lessonButton,#suggest,#clearSelection,#playCards').evaluateAll(nodes=>nodes.every(node=>{
      const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight&&r.height>=(innerWidth<1050?43:32);
    }));check(visible,'all controls fit at '+size.width+'x'+size.height);
    check(await page.locator('#playerHand').getAttribute('data-rows')==='1','33 cards stay in one row');
    check(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),'no page scrolling');
    const card=await page.locator('.hand-slot .face').first().boundingBox();
    check(card.width>=71,'hand remains readable');sizes.push({...size,cardWidth:card.width});
    await page.screenshot({path:'/Users/tonyyunyang/Code/frontend/80-fen-shengji-site/output/playwright/mobile-bury-'+size.width+'.png'});
  }
  await page.setViewportSize({width:390,height:844});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
  const hand=await page.locator('#playerHand').boundingBox(),y=hand.y+hand.height-65;
  await touch('touchStart',320,y);
  for(let i=1;i<=15;i++){await touch('touchMove',320-i*16,y+2);await page.waitForTimeout(18);}
  await touch('touchEnd');await page.waitForTimeout(450);
  const scroll=await page.locator('#playerHand').evaluate(node=>node.scrollLeft);
  check(scroll>100&&await page.locator('.hand-slot[aria-pressed=true]').count()===0&&actions.length===0,'swipe scrolls without selecting/submitting');
  await page.getByRole('button',{name:'帮选',exact:true}).click();
  check(await page.locator('.hand-slot[aria-pressed=true]').count()===8,'eight burial cards');
  await page.getByRole('button',{name:'确认扣底 ↵',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.hand-slot').length===25);
  check(actions.length===1&&actions[0].action.type==='bury','burial confirms once');
  await page.getByRole('button',{name:'帮选',exact:true}).click();
  const card=page.locator('.hand-slot[aria-pressed=true]').first();
  await card.scrollIntoViewIfNeeded();await page.waitForTimeout(120);
  const from=await card.boundingBox(),target=await page.locator('#dropTarget').boundingBox();
  const x=from.x+12,startY=from.y+from.height-45,endY=target.y+target.height/2;
  const endX=Math.max(target.x+12,Math.min(target.x+target.width-12,x));
  await touch('touchStart',x,startY);
  for(let i=1;i<=15;i++){await touch('touchMove',x+(endX-x)*i/15,startY+(endY-startY)*i/15);await page.waitForTimeout(16);}
  await touch('touchEnd');
  await page.waitForFunction(()=>document.querySelectorAll('.hand-slot').length===24);
  check(actions.length===2&&actions[1].action.cardIds.length===1,'upward touch drag plays exactly once');
  const before=await state(),cookieBefore=await page.context().cookies();
  await page.getByRole('button',{name:'☰ 菜单',exact:true}).click();
  await page.getByRole('button',{name:'返回主菜单',exact:true}).click();
  const paused=await state();check(paused.paused,'menu pauses the game');
  await page.waitForTimeout(250);check((await state()).game.version===paused.game.version,'old game stops advancing');
  await page.getByRole('button',{name:'新游戏',exact:true}).click();
  await page.getByRole('button',{name:'一人 · 三陪练',exact:true}).click();
  await page.getByRole('button',{name:'开始新牌桌 →',exact:true}).click();
  await page.getByRole('button',{name:'开始新对局',exact:true}).click();
  const restarted=await state(),cookieAfter=await page.context().cookies();
  check(restarted.game.id!==before.game.id&&restarted.archives.some(row=>row.id===before.game.id&&!row.completed),'new game replaces unfinished one');
  check(cookieBefore.every(cookie=>cookieAfter.some(next=>next.name===cookie.name&&next.value===cookie.value)),'restart reuses the same table cookie');
  check(restarted.stats.realRequests===0&&restarted.stats.input===0,'no live provider calls');
  await page.getByRole('button',{name:'☰ 菜单',exact:true}).click();
  await page.getByRole('button',{name:'返回主菜单',exact:true}).click();
  await cdp.detach();check(errors.length===0,errors.join('\n'));
  return {sizes,horizontalSwipe:scroll,buriedEightOnce:true,upwardDragOnce:true,menuPauses:true,restartSameTable:true,liveModelCalls:0,consoleErrors:0};
}
