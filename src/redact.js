// Provider metadata is untrusted: even an error or usage field can echo a key.
export function redact(value, secrets = []) {
  const tokens = secrets.filter(s => typeof s === 'string' && s.length >= 8).flatMap(s => [s, encodeURIComponent(s)]);
  if (typeof value === 'string') {
    for (const token of tokens) value = value.split(token).join('[REDACTED]');
    return value.replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]');
  }
  if (Array.isArray(value)) return value.map(v => redact(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [redact(key, secrets), redact(v, secrets)]));
  return value;
}
