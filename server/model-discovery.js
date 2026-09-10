const validId=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/;
const finiteRate=value=>['number','string'].includes(typeof value)&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;

export function modelsUrl(profile) {
  const base=profile.baseUrl.replace(/\/+$/,'');
  return base+(profile.provider==='claude'&&!base.endsWith('/v1')?'/v1/models':'/models');
}

export function modelPrice(model, baseUrl) {
  const price=model.pricing;
  if (!price||typeof price!=='object') return {input:null,output:null};
  let input=null,output=null,multiplier=1;
  // OpenRouter explicitly defines prompt/completion as USD per token. Other
  // services must supply a currency and unit; a bare number is ambiguous.
  if (new URL(baseUrl).hostname==='openrouter.ai') {
    input=finiteRate(price.prompt);output=finiteRate(price.completion);multiplier=1e6;
  } else if (price.currency==='USD'&&['per_token','per_million_tokens'].includes(price.unit)) {
    input=finiteRate(price.input);output=finiteRate(price.output);multiplier=price.unit==='per_token'?1e6:1;
  }
  return {input:input!==null&&input*multiplier<=10000?input*multiplier:null,output:output!==null&&output*multiplier<=10000?output*multiplier:null};
}

export async function discoverModels(profile,key,fetchImpl) {
  const headers=profile.provider==='claude'?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{authorization:'Bearer '+key};
  let response,body;
  try {
    response=await fetchImpl(modelsUrl(profile),{method:'GET',headers,signal:AbortSignal.timeout(6500)});
    if (!response.ok) {
      if ([401,403].includes(response.status)) throw new Error('模型列表认证失败，请检查协议、地址和 key');
      if ([404,405,501].includes(response.status)) throw new Error('这个接口不支持读取模型列表，请手动填写模型 ID');
      throw new Error('读取模型列表失败（HTTP '+response.status+'），可以稍后重试或手动填写');
    }
    try { body=await response.json(); } catch { throw new Error('模型列表响应格式无效，请手动填写模型 ID'); }
  } catch(error) {
    // Never forward provider response bodies, URLs with credentials, or raw
    // transport errors. Our authored errors have no remote content.
    if (/^(模型列表认证失败|这个接口不支持|读取模型列表失败|模型列表响应格式无效)/.test(error.message)) throw error;
    throw new Error('无法读取模型列表，请检查地址或手动填写模型 ID');
  }
  const rows=Array.isArray(body?.data)?body.data:Array.isArray(body?.models)?body.models:null;
  if (!rows) throw new Error('模型列表响应格式无效，请手动填写模型 ID');
  const models=[],seen=new Set();let skipped=0;
  for(const row of rows){
    const outputs=row?.architecture?.output_modalities||row?.output_modalities;
    const parameters=Array.isArray(row?.supported_parameters)?row.supported_parameters:null;
    const id=row?.id,rawLabel=String(row?.display_name||row?.name||id||''),label=rawLabel.slice(0,80);
    const nonChatId=!Array.isArray(outputs)&&!parameters?.includes('tools')&&/(?:^|[-_/])(image|video|audio|tts|realtime|whisper|embedding|embeddings|moderation)(?:$|[-_/])/.test(id||'');
    if (typeof id!=='string'||!validId.test(id)||id.includes(key)||rawLabel.includes(key)||seen.has(id)||nonChatId||Array.isArray(outputs)&&!outputs.includes('text')||parameters&&!parameters.includes('tools')) {skipped++;continue;}
    if (models.length===256) break;
    seen.add(id);models.push({id,label,...modelPrice(row,profile.baseUrl)});
  }
  return {models,skipped,partial:body.has_more===true||rows.length-skipped>256};
}
