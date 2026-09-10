import { randomUUID } from 'node:crypto';
import { providerUrl, safeProviderFetch } from './safe-network.js';
import { discoverModels } from './model-discovery.js';

const modelId = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/;
const rate = value => value === undefined || value === null || value === '' ? null : Number(value);
export class Connections {
  constructor({ saved = [], allowLoopback = false, fetchImpl } = {}) {
    this.allowLoopback = allowLoopback;
    this.fetchImpl = fetchImpl || safeProviderFetch({ allowLoopback });
    this.profiles = new Map();
    this.keys = new Map();
    for (const profile of saved) {
      try {
        if (!['alibaba','openai','anthropic'].includes(profile.id) && !/^[0-9a-f-]{36}$/.test(profile.id)) continue;
        // Empty shipped presets were not user connections. Keep only configured
        // legacy profiles so old checkpoints can still bind their seats.
        if (['alibaba','openai','anthropic'].includes(profile.id) && (!profile.models?.length || profile.models.every(m=>m.builtin))) continue;
        const validated = this.validate(profile); validated.id = profile.id; this.profiles.set(profile.id, validated);
      } catch {}
    }
  }
  validate(input) {
    if (!input || !['qwen', 'openai', 'claude'].includes(input.provider)) throw new Error('请选择受支持的工具调用协议');
    if (typeof input.name !== 'string' || typeof input.baseUrl !== 'string') throw new Error('请填写连接名称和 API 地址');
    const name = String(input.name || '').trim(), baseUrl = String(input.baseUrl || '').trim().replace(/\/+$/, '');
    if (!name || name.length > 50 || /[\r\n]/.test(name)) throw new Error('连接名称应为 1–50 个字符');
    providerUrl(baseUrl, this);
    if (!Array.isArray(input.models) || input.models.length > 256) throw new Error('每个连接最多配置 256 个模型');
    const models = input.models.map(m => {
      if (typeof m?.id !== 'string' || !modelId.test(m.id)) throw new Error('模型 ID 只能包含字母、数字及 . _ : / -');
      const inputRate = rate(m.input), outputRate = rate(m.output);
      if ([inputRate, outputRate].some(n => n !== null && (!Number.isFinite(n) || n < 0 || n > 10000))) throw new Error('参考价格必须是有效的非负数字');
      return { id: m.id, label: String(m.label || m.id).slice(0, 80), input: inputRate, output: outputRate };
    });
    if (new Set(models.map(m => m.id)).size !== models.length) throw new Error('模型 ID 不能重复');
    const id = input.id && this.profiles.has(input.id) ? input.id : randomUUID();
    return { id, name, provider: input.provider, baseUrl, models };
  }
  save(input) {
    if (input?.key !== undefined && typeof input.key !== 'string') throw new Error('API key 格式无效');
    const profile = this.validate(input), key = String(input.key || '').trim();
    if (!this.profiles.has(profile.id) && this.profiles.size >= 8) throw new Error('每个浏览器会话最多保存 8 个连接');
    if (key && (key.length < 8 || key.length > 4096 || /[^\x21-\x7e]/.test(key))) throw new Error('API key 格式无效');
    const old = this.profiles.get(profile.id);
    const effectiveKey = key || this.keys.get(profile.id);
    if (effectiveKey && JSON.stringify(profile).includes(effectiveKey)) throw new Error('请只在密钥栏填写 API key');
    // A saved key never migrates silently to a changed destination.
    if (old && (old.baseUrl !== profile.baseUrl || old.provider !== profile.provider)) this.keys.delete(profile.id);
    this.profiles.set(profile.id, profile);
    if (key) this.keys.set(profile.id, key);
    return profile.id;
  }
  forget(id = null) { if (id) this.keys.delete(id); else this.keys.clear(); }
  async discover(input) {
    if (this.discovering) throw new Error('正在读取模型，请稍候');
    const profile=this.validate({...input,models:[]}),old=this.profiles.get(input.id);
    const key=input.key || (old?.baseUrl===profile.baseUrl&&old?.provider===profile.provider?this.keys.get(input.id):null);
    if (typeof key!=='string'||key.length<8||key.length>4096||/[^\x21-\x7e]/.test(key)) throw new Error('请先填写这个地址对应的 API key');
    if (JSON.stringify(profile).includes(key)) throw new Error('请只在密钥栏填写 API key');
    this.discovering=true;
    try { return await discoverModels(profile,key,this.fetchImpl); }
    finally { this.discovering=false; }
  }
  remove(id) {
    this.keys.delete(id); this.profiles.delete(id);
  }
  snapshot() { return [...this.profiles.values()].map(p => structuredClone(p)); }
  list() { return this.snapshot().map(p => ({ ...p, active: this.keys.has(p.id) })); }
  status() {
    return { mock: true, ...Object.fromEntries(['qwen', 'openai', 'claude'].map(provider => [provider, [...this.profiles.values()].some(p => p.provider === provider && this.keys.has(p.id))])) };
  }
  bind(seat) {
    if (seat.kind !== 'api' || seat.provider === 'mock') return seat;
    const profile = seat.connectionId ? this.profiles.get(seat.connectionId) :
      this.profiles.get(({ qwen: 'alibaba', openai: 'openai', claude: 'anthropic' })[seat.provider]);
    if (!profile && !seat.connectionId) return seat; // Inactive legacy seat uses the preserved fallback.
    if (!profile) throw new Error('所选 API 连接不存在');
    if (seat.connectionId && !profile.models.some(m => m.id === seat.model)) throw new Error('请先在该连接中添加这个模型');
    return { ...seat, provider: profile.provider, connectionId: profile.id };
  }
  resolve(seat) {
    if (seat.provider === 'mock') return { env: {}, fetchImpl: this.fetchImpl };
    const id = seat.connectionId || ({ qwen: 'alibaba', openai: 'openai', claude: 'anthropic' })[seat.provider];
    const profile = this.profiles.get(id), key = this.keys.get(id), model = profile?.models.find(m => m.id === seat.model);
    if (!profile || !key || !model || seat.provider !== profile.provider) return { env: {} };
    const env = profile.provider === 'qwen' ? { QWEN_API_KEY: key, QWEN_BASE_URL: profile.baseUrl } :
      profile.provider === 'openai' ? { OPENAI_API_KEY: key, OPENAI_BASE_URL: profile.baseUrl } : { ANTHROPIC_API_KEY: key, ANTHROPIC_BASE_URL: profile.baseUrl };
    return { env, fetchImpl: this.fetchImpl, allowCustomModel: true,
      referencePrice: model.input !== null && model.output !== null ? { input: model.input, output: model.output } : null };
  }
}
