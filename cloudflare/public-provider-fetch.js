import {resolve4,resolve6} from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import {publicAddress,providerUrl} from '../server/safe-network.js';
import {boundedText} from './sponsor-core.js';

export async function publicAnswers(host,queries=[resolve4,resolve6]){
  const answers=await Promise.allSettled(queries.map(query=>query(host)));
  // Workers includes CNAME values in resolve4/resolve6 results. Only IP
  // records are destinations; aliases alone must never authorize a fetch.
  return answers.flatMap((result,index)=>result.status==='fulfilled'?result.value.filter(address=>typeof address==='string'&&ipaddr.isValid(address)).map(address=>({address,family:index?6:4})):[]);
}
function interruptible(promise,signal){
  if(!signal)return promise;
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason||new Error('Cancelled'));};
    if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});
    promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}

// Workers' node:https wrapper cannot pin a custom lookup. Keep the Node
// transport unchanged; here validate DNS on every call and use strictly-public
// platform fetch, with no VPC/Tunnel/private-network binding or redirects.
export function publicProviderFetch({resolve=publicAnswers,fetchImpl=fetch}={}){
  return async(value,options={})=>{
    const url=providerUrl(value),host=url.hostname.replace(/^\[|\]$/g,'');
    const discovery=options.method==='GET'&&/\/models$/.test(url.pathname)&&options.body===undefined;
    if(!discovery&&(options.method!=='POST'||typeof options.body!=='string'||!/(?:\/chat\/completions|\/responses|\/messages)$/.test(url.pathname)))throw new Error('不支持的提供商请求');
    if(!discovery&&new TextEncoder().encode(options.body).byteLength>65536)throw new Error('提供商请求超过大小上限');
    options.signal?.throwIfAborted();
    let addresses;
    try{addresses=ipaddr.isValid(host)?[{address:host}]:await interruptible(resolve(host),options.signal);}catch{options.signal?.throwIfAborted();throw new Error('无法解析提供商地址');}
    options.signal?.throwIfAborted();
    if(!addresses.length)throw new Error('无法解析提供商地址');
    if(addresses.some(item=>!publicAddress(item.address)))throw new Error('提供商地址解析到私有或保留网络');
    try{
      const response=await fetchImpl(url.href,{method:options.method,headers:{...options.headers,'accept':'application/json','user-agent':'Eighty-Website/0.3.0 (tonytheyang.com)'},...(discovery?{}:{body:options.body}),signal:options.signal,redirect:'manual'});
      if(response.status>=300&&response.status<400){await response.body?.cancel();throw new Error('提供商重定向被拒绝');}
      const text=await boundedText(response.body,1048576);
      return {ok:response.ok,status:response.status,headers:response.headers,json:async()=>JSON.parse(text)};
    }catch(error){
      if(error.message==='提供商重定向被拒绝')throw error;
      throw new Error(options.signal?.aborted?'提供商请求已取消':'提供商连接失败');
    }
  };
}
