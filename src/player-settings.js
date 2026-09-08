export const MAX_DECISION_MS = 12000;
export const DEAL_INTERVAL_MS = 500;
export const CLOSING_WINDOW_MS = 5000;
export const BID_REVIEW_INTERVAL_MS = 2000;
export function boundedInteger(value, fallback, minimum, maximum) {
  if (value != null && !['number', 'string'].includes(typeof value)) throw new Error('设置中需要有效数字');
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(number)) throw new Error('设置中需要有效数字');
  return Math.floor(Math.max(minimum, Math.min(maximum, number)));
}
export const decisionTimeoutMs = (value) => boundedInteger(value, MAX_DECISION_MS, 1000, MAX_DECISION_MS);
