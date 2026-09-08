import { tokenPlanModel, CATALOG_CHECKED_AT, MODEL_SOURCES } from './model-catalog.js';

// Values not reported by a provider remain null, not fabricated zero usage.
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function normalizeUsage(provider, raw) {
  if (!raw || typeof raw !== 'object') return { input: null, output: null, cached: null, cacheWrite: null, reasoning: null, total: null };
  const sumReported = (...values) => values.some((v) => v !== null) ? values.reduce((sum, v) => sum + (v ?? 0), 0) : null;
  let input, output, cached, cacheWrite, reasoning;
  if (provider === 'claude') {
    cached = count(raw.cache_read_input_tokens) ?? 0;
    cacheWrite = count(raw.cache_creation_input_tokens) ?? 0;
    const uncached = count(raw.input_tokens);
    input = uncached === null ? null : uncached + cached + cacheWrite;
    output = count(raw.output_tokens);
    reasoning = count(raw.output_tokens_details?.reasoning_tokens);
  } else if (provider === 'openai') {
    input = count(raw.input_tokens); output = count(raw.output_tokens);
    cached = count(raw.input_tokens_details?.cached_tokens);
    cacheWrite = count(raw.input_tokens_details?.cache_write_tokens);
    reasoning = count(raw.output_tokens_details?.reasoning_tokens);
  } else {
    input = count(raw.prompt_tokens); output = count(raw.completion_tokens);
    cached = count(raw.prompt_tokens_details?.cached_tokens);
    cacheWrite = count(raw.prompt_tokens_details?.cache_write_tokens);
    reasoning = count(raw.completion_tokens_details?.reasoning_tokens);
  }
  return { input, output, cached, cacheWrite, reasoning,
    total: count(raw.total_tokens) ?? (input !== null && output !== null ? sumReported(input, output) : null) };
}
export const REFERENCE_PRICING = Object.freeze({
  model: 'qwen3.8-flash', currency: 'USD', inputPerMillion: tokenPlanModel('qwen3.8-flash').input, outputPerMillion: tokenPlanModel('qwen3.8-flash').output,
  region: 'Singapore / International', checkedAt: CATALOG_CHECKED_AT,
  source: MODEL_SOURCES.pricing,
});
export function referenceCost(model, usage) {
  const price = tokenPlanModel(model);
  // Compact game prompts fit well below every listed tier boundary. Larger
  // prompts need a separate tier-aware quote, not an extrapolated base rate.
  if (!price || !usage || count(usage.input) === null || count(usage.output) === null || usage.input > 128000) return null;
  return {
    amount: (usage.input * price.input + usage.output * price.output) / 1e6,
    currency: 'USD', basis: 'Singapore compact-prompt PAYG reference; busy-hour rate when variable; cache discounts and promotions excluded',
    actualCharge: false, tokenPlanCredits: null, priceDate: CATALOG_CHECKED_AT,
  };
}
