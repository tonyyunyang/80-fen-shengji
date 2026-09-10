import { kimiCodeRequestOptions } from '/src/model-catalog.js';
import { t, pick } from './i18n.js';
import { escapeHtml as escape } from './dom.js';
const option=(id,label,selected)=>`<option value="${escape(id)}"${id===selected?' selected':''}>${escape(label)}</option>`;
export const connectionFor=(seat,profiles=[])=>profiles.find(p=>p.id===(seat.connectionId||({qwen:'alibaba',openai:'openai',claude:'anthropic'})[seat.provider]));
const rate=value=>value==null?'—':'$'+Number(value).toLocaleString('en-US',{maximumSignificantDigits:6});
const price=model=>model.input!=null||model.output!=null?rate(model.input)+' / '+rate(model.output):null;
export function apiSeatFields(seat,index,profiles){
  const profile=connectionFor(seat,profiles),current=seat.provider==='mock'?'mock':profile?.id;
  return `<div class="provider-options"><label for="provider-${index}">${pick('API 连接','API connection')}</label><select id="provider-${index}" aria-label="${pick('座位 ','Seat ')+index} API">`+
    (!current?`<option value="" selected disabled>${profiles.length?pick('选择一个连接','Choose a connection'):pick('尚未添加连接','No connection yet')}</option>`:'')+
    profiles.map(p=>option(p.id,p.name+(p.active?pick(' · 已启用',' · enabled'):pick(' · 需要 key',' · needs a key')),current)).join('')+
    option('mock',pick('离线模拟 · 不调用模型','Offline simulation · no model'),current)+'</select>'+
    (seat.provider==='mock'?'':`<div class="seat-connection-route"><button class="secondary" type="button" data-manage-connection="${escape(profile?.id||'')}" data-api-seat="${index}">${profile?profile.active?pick('管理这条连接','Manage this connection'):pick('启用 / 管理连接','Enable / manage connection'):pick('＋ 添加 API 连接','＋ Add API connection')} ↗</button><small>${profile?profile.active?pick('需要更换服务或 key，可直接在这里管理。','Manage this service or its key here.'):pick('在这里填入 key 并读取模型，完成后回到这一席。','Enter a key and read models here, then return to this seat.'):pick('点击这里添加，也可使用右侧「API 连接」。','Add it here, or use API connections in the side panel.')}</small></div>`)+
    (seat.provider==='mock'?'':`<label class="model-label" for="model-${index}">${pick('模型','Model')}</label><select id="model-${index}" aria-label="${pick('座位 ','Seat ')+index} ${pick('模型','model')}">`+
      (!profile?.models.some(m=>m.id===seat.model)?`<option value="" disabled selected>${pick('连接后选择模型','Connect, then choose a model')}</option>`:'')+
      (profile?.models||[]).map(m=>option(m.id,m.label+(price(m)?' · '+price(m):''),seat.model)).join('')+'</select>'+
      `<small class="connection-note">${profile?.active?pick('模型只看自己的手牌与公开牌桌。','The model sees its own hand and the public table.'):pick('未启用时由陪练代打，零 API 请求。','Inactive connections use a practice bot, with no API requests.')}</small>`+
      (kimiCodeRequestOptions(seat.model,profile?.baseUrl,512)?`<small class="connection-note">${pick('Kimi Code 使用快速、无思考的 JSON 动作；按服务商规则实际走 K2.6 路由，所选模型 ID 不变。','Kimi Code uses fast, non-thinking JSON actions. The provider routes this to K2.6 while retaining the selected model ID.')}</small>`:'')+
      `<small class="connection-note">${price(profile?.models.find(m=>m.id===seat.model)||{})?pick('USD / 百万 tokens 参考价；— 表示未提供。','Reference USD / million token prices; — means unspecified.'):pick('提供商未返回价格。','The provider has not supplied a price.')}</small>`+
      `<details class="seat-ai-options" id="ai-options-${index}"><summary>${pick('AI 策略选项','AI strategy options')}</summary><label class="option-row" for="prompt-language-${index}">${pick('策略提示词语言','Strategy prompt language')}<select id="prompt-language-${index}">${option('zh','中文',seat.promptLanguage||'zh')}${option('en','English',seat.promptLanguage||'zh')}</select></label><label class="option-row" for="endgame-${index}">${pick('残局推演 · 实验','Endgame analysis · experimental')}<input type="checkbox" id="endgame-${index}"${seat.endgameAnalysis!==false?' checked':''}></label><small class="connection-note">${pick('最后十二张内，结合公开牌史比较可能的残局。不会额外请求模型；只是估计，不保证胜率，可以关闭。','With twelve cards or fewer, compare possible endings consistent with public play. Adds no model round trips; estimates are uncertain and can be disabled.')}</small><small class="connection-note">${pick('模型根据本席手牌、公开记牌和搭档关系独立决策，目标是本方赢牌。中英文提供相同信息；回复只含出牌动作。超时或无效动作仍由陪练接手。','The model independently chooses for the team using its own hand, public card memory and partnership roles. Both languages supply the same information; replies contain only the action. Timeouts or invalid actions still fall back to the practice bot.')}</small></details>`)+ '</div>';
}
export function setupConnectionsDialog({state,post,refresh,notify,onLinked=()=>{}}){
  const $=id=>document.getElementById(id);let editing=null,catalog=new Map(),busy=false,sourceSeat=null,sourceConnection=null;
  const tell=message=>{$('connectionStatus').textContent=message;};
  const labels={connectionTitle:['连接你的模型','Connect your model'],connectionPrivacy:['key 仅保存在本浏览器会话的服务端内存。不会写入网页存储或牌谱；重启服务或会话空闲过期后清除。','Keys stay in server memory for this browser session. They never enter browser storage or replays and clear on server restart or session expiry.'],newConnection:['＋ 添加连接','＋ Add connection'],forgetAllKeys:['清除所有 key','Clear all keys'],protocolLabel:['接口协议','Protocol'],baseUrlLabel:['API 基础地址','Base URL'],baseUrlHelp:['填写基础地址，不带 /chat/completions 或 /messages。更换地址后需要重新输入 key。','Use the base URL, without /chat/completions or /messages. A changed address needs its own key.'],keyLabel:['API key','API key'],discoverModels:['连接并读取模型','Connect & read models'],discoveryHelp:['读取服务的 /models 列表，不发起对话。没有列表接口时，可以手动填写模型 ID。','Reads the service’s /models list without generating a response. If unavailable, enter model IDs manually.'],connectionNameLabel:['连接名称','Connection name'],modelListLabel:['可用模型','Available models'],modelListHelp:['读取后自动填入，每行一个模型 ID；可编辑。列表不代表模型一定支持本游戏的工具调用。价格仅在接口明确返回时显示。','Populated automatically; one editable model ID per line. Being listed does not verify game tool support. Prices appear only when explicitly supplied.'],saveConnection:['保存连接','Save connection'],forgetConnection:['清除此 key','Clear this key'],deleteConnection:['删除连接','Delete connection']};
  for(const [id,values]of Object.entries(labels))$(id).textContent=pick(...values);
  $('connectionName').placeholder=pick('例如：我的模型服务','For example: My model service');$('connectionModels').placeholder=pick('连接后自动读取，或手动填写模型 ID','Read from your service, or enter model IDs');$('closeConnections').setAttribute('aria-label',pick('关闭 API 连接','Close API connections'));
  function list(){
    $('connectionList').innerHTML=(state()?.connections||[]).map(p=>`<button type="button" data-connection="${p.id}" class="connection-choice${p.id===editing?' selected':''}"><span>${escape(p.name)}</span><small>${p.active?pick('已启用','Enabled'):pick('需要 key','Key required')} · ${p.models.length} ${pick('个模型','models')}</small></button>`).join('')||`<p class="fine">${pick('连接一个模型服务，再把模型分配给座位。','Connect a service, then assign its models to seats.')}</p>`;
    document.querySelectorAll('[data-connection]').forEach(button=>button.onclick=()=>{if(!busy)edit(button.dataset.connection);});
  }
  function showPrices(){
    const known=[...catalog.values()].filter(m=>price(m));
    $('discoveredPrices').innerHTML=known.length?`<details><summary>${pick('接口返回的参考价格','Provider-reported prices')}</summary><p class="fine">USD / ${pick('百万 tokens，输入 / 输出','million tokens, input / output')}</p>${known.map(m=>`<p>${escape(m.label)} <b>${price(m)}</b></p>`).join('')}</details>`:`<p class="fine">${pick('未返回价格，不估算套餐费用。','No prices supplied. Plan charges are not estimated.')}</p>`;
  }
  function edit(id){
    editing=id;const p=state()?.connections?.find(item=>item.id===id);catalog=new Map((p?.models||[]).map(m=>[m.id,m]));
    $('connectionName').value=p?.name||'';$('connectionProtocol').value=p?.provider||'qwen';$('connectionUrl').value=p?.baseUrl||'';$('connectionModels').value=(p?.models||[]).map(m=>m.id).join('\n');$('connectionKey').value='';tell('');
    $('connectionKey').placeholder=p?.active?pick('已保存；留空保留','Saved; leave blank to keep'):pick('粘贴自己的 API key','Paste your API key');
    $('forgetConnection').disabled=!p?.active;$('deleteConnection').hidden=!p;list();showPrices();
  }
  function open(id,seat=null){
    if(!busy){sourceSeat=seat;sourceConnection=id||null;edit(id===undefined?state()?.connections?.[0]?.id||null:id);}
    $('connectionSeatHint').hidden=sourceSeat===null;
    $('connectionSeatHint').textContent=sourceSeat===null?'':pick('正在为'+['南','东','北','西'][sourceSeat]+'家配置。保存后，回到这一席选择模型。','Configuring '+['South','East','North','West'][sourceSeat]+'. After saving, choose a model for this seat.');
    if(!$('connectionsDialog').open)$('connectionsDialog').showModal();
  }
  function input(){
    const baseUrl=$('connectionUrl').value.trim();let name=$('connectionName').value.trim();
    try{name||=new URL(baseUrl).hostname;}catch{}
    const models=$('connectionModels').value.split('\n').map(id=>id.trim()).filter(Boolean).map(id=>catalog.get(id)||{id});
    return {id:editing,name,provider:$('connectionProtocol').value,baseUrl,models,key:$('connectionKey').value.trim()};
  }
  function pending(value){busy=value;for(const id of ['saveConnection','discoverModels','newConnection','forgetAllKeys','deleteConnection','forgetConnection','connectionProtocol','connectionUrl','connectionKey','connectionName','connectionModels'])$(id).disabled=value;}
  async function save(readModels){
    if(busy||!$('connectionForm').reportValidity())return;
    const values=input();
    const seat=sourceSeat,previousConnection=sourceConnection;
    if(values.key&&location.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(location.hostname)){$('connectionKey').value='';tell(pick('请通过 HTTPS 或本机地址配置密钥','Use HTTPS or localhost to configure a key'));return;}
    pending(true);tell(readModels?pick('正在连接并读取模型…','Connecting and reading models…'):pick('正在保存…','Saving…'));
    let message;
    try{
      const saved=await post('connections/save',values);const savedId=saved.id;editing=savedId;
      $('connectionKey').value='';
      if(readModels){
        const result=await post('connections/discover',{...values,id:savedId,key:''});
        await post('connections/save',{...values,id:savedId,key:'',models:result.models});
        message=pick('读取到 '+result.models.length+' 个模型。','Read '+result.models.length+' models.')+(result.partial?pick(' 这是部分列表；其余模型可以手动添加。',' This is a partial list; add other models manually.'):'');
      }else message=pick('连接已保存，可以为座位选择模型。','Connection saved. You can now assign models to seats.');
    }catch(error){message=error.message;}
    finally{values.key='';$('connectionKey').value='';await refresh().catch(()=>{});pending(false);edit(editing);tell(message);const profile=state()?.connections?.find(p=>p.id===editing);if(profile&&seat!==null&&onLinked(seat,profile,previousConnection))sourceConnection=profile.id;}
  }
  $('connectionsButton').onclick=()=>open();$('closeConnections').onclick=()=>{$('connectionKey').value='';$('connectionsDialog').close();};$('newConnection').onclick=()=>{if(!busy)edit(null);};
  $('connectionsDialog').addEventListener('cancel',()=>{$('connectionKey').value='';});
  $('connectionsDialog').addEventListener('close',()=>{$('connectionKey').value='';if(sourceSeat!==null)requestAnimationFrame(()=>{const target=$('model-'+sourceSeat)||document.querySelector(`[data-api-seat="${sourceSeat}"]`);if(target?.getClientRects().length){target.focus({preventScroll:true});target.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}});});window.addEventListener('pagehide',()=>{$('connectionKey').value='';});
  document.addEventListener('click',event=>{const button=event.target.closest('[data-manage-connection]');if(button)open(button.dataset.manageConnection||null,Number(button.dataset.apiSeat));});
  $('connectionForm').onsubmit=event=>{event.preventDefault();save(false);};$('discoverModels').onclick=()=>save(true);
  // Switching endpoints clears stale model choices instead of carrying them to
  // an unrelated provider. The server independently enforces key destinations.
  for(const id of ['connectionUrl','connectionProtocol'])$(id).onchange=()=>{catalog.clear();$('connectionModels').value='';showPrices();};
  for(const [id,path]of [['forgetConnection','forget'],['deleteConnection','delete'],['forgetAllKeys','forget']])$(id).onclick=async()=>{if(busy)return;try{await post('connections/'+path,{id:id==='forgetAllKeys'?undefined:editing});await refresh();edit(path==='delete'?null:editing);tell(pick('已清除。','Cleared.'));}catch(error){notify(error.message);}};
  return {open};
}
