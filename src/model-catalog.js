// Explicit Token Plan membership, not the much larger Model Studio model list.
// Rates are Singapore PAYG comparisons, never a promise of Token Plan Credits.
export const CATALOG_CHECKED_AT = '2026-09-08';
export const MODEL_SOURCES = Object.freeze({
  plan: 'https://www.alibabacloud.com/help/en/model-studio/token-plan-personal-overview',
  pricing: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
  tools: 'https://www.alibabacloud.com/help/en/model-studio/qwen-function-calling',
  chat: 'https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions',
  glm: 'https://www.alibabacloud.com/help/en/model-studio/glm',
  deepseek: 'https://www.alibabacloud.com/help/en/model-studio/deepseek-api',
});
export const DEFAULT_TOKEN_PLAN_MODEL = 'qwen3.8-flash';
export const TOKEN_PLAN_MODELS = Object.freeze([
  { id: 'qwen3.8-flash', label: 'Qwen 3.8 Flash', family: 'Qwen', input: 0.15, output: 0.47, liveVerified: true },
  { id: 'qwen3.8-max', label: 'Qwen 3.8 Max', family: 'Qwen', input: 2, output: 6, toolVerified: true },
  { id: 'qwen3.7-plus', label: 'Qwen 3.7 Plus', family: 'Qwen', input: 0.4, output: 1.6,
    largerContext: { above: '256K', input: 1.2, output: 4.8 }, toolVerified: true },
  { id: 'qwen3.7-max', label: 'Qwen 3.7 Max', family: 'Qwen', input: 2.5, output: 7.5, toolVerified: true },
  { id: 'qwen3.6-flash', label: 'Qwen 3.6 Flash', family: 'Qwen', input: 0.25, output: 1.5,
    largerContext: { above: '256K', input: 1, output: 4 }, toolVerified: true },
  { id: 'deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro · 0813', family: 'DeepSeek', input: 1.32, output: 3.96,
    offPeak: { input: 0.66, output: 1.98 }, toolVerified: true },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', family: 'DeepSeek', input: 2.4, output: 4.8, toolVerified: true },
  { id: 'deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash · 0731', family: 'DeepSeek', input: 0.44, output: 1.32,
    offPeak: { input: 0.22, output: 0.66 }, toolVerified: true },
  { id: 'glm-5.2', label: 'GLM 5.2', family: 'GLM', input: 1.4, output: 4.4, toolVerified: true, testedOutputLimit: 512 },
].map((model) => Object.freeze({ ...model, text: true, toolCalling: true, nonThinking: true, liveVerified: model.liveVerified === true, toolVerified: model.toolVerified === true || model.liveVerified === true })));

export const tokenPlanModel = (id) => TOKEN_PLAN_MODELS.find((model) => model.id === id) || null;
export const formatRate = (rate) => '$' + rate.toFixed(2);
export function isTokenPlanEndpoint(baseUrl) {
  try { return new URL(baseUrl).hostname === 'token-plan.ap-southeast-1.maas.aliyuncs.com'; } catch { return false; }
}
export function assertTokenPlanModel(id, baseUrl) {
  if (isTokenPlanEndpoint(baseUrl) && !tokenPlanModel(id)) throw new Error('请选择 Token Plan 列表内支持文本和工具调用的模型');
}

// All listed models document complete-output caps and a non-thinking mode.
export function tokenPlanRequestOptions(id, maxOutput, toolName, thinking = false) {
  const model = tokenPlanModel(id);
  if (!model) return null;
  return {
    max_completion_tokens: maxOutput, enable_thinking: thinking,
    parallel_tool_calls: false, stream: false,
    ...(model.family === 'Qwen' ? { preserve_thinking: false } : {}),
    // GLM's model page confirms non-streaming tool responses; the generic
    // tool guide also requests this flag. It is harmless for stream:false.
    ...(model.family === 'GLM' ? { tool_stream: true, clear_thinking: true } : {}),
    tool_choice: model.family !== 'DeepSeek' && !thinking ? { type: 'function', function: { name: toolName } } : 'auto',
  };
}

// Kimi Code documents `none` as its non-thinking route (currently K2.6).
// Scope this to the actual managed endpoint; never guess flags for other hosts.
export function kimiCodeRequestOptions(id, baseUrl, maxOutput, thinking = false, toolName) {
  let url;
  try { url = new URL(baseUrl); } catch { return null; }
  if (url.origin !== 'https://api.kimi.com' || !/^\/coding\/v1\/?$/.test(url.pathname) ||
      !['k3','k3-256k','kimi-for-coding','kimi-for-coding-highspeed'].includes(id)) return null;
  return { max_tokens: maxOutput, tool_choice: toolName && !thinking ? { type: 'function', function: { name: toolName } } : 'auto', parallel_tool_calls: false,
    stream: false, reasoning_effort: thinking ? 'low' : 'none' };
}
