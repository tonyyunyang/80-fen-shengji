export const DEFAULT_PREFERENCES = Object.freeze({
  fourColor: true, motion: true, learning: false, texture: true, hints: true,
  dragToPlay: true, sound: true, volume: 50, music: true, musicVolume: 30,
  handSize: 1, tableSize: 1, textSize: 1, effects: 'full',
});

export function readPreferences(value) {
  const result = { ...DEFAULT_PREFERENCES };
  for (const [key, fallback] of Object.entries(result)) {
    if (typeof fallback === 'boolean' && typeof value?.[key] === 'boolean') result[key] = value[key];
  }
  for (const [key, allowed] of Object.entries({ handSize: [.9, 1, 1.15], tableSize: [.85, 1, 1.2], textSize: [1, 1.15, 1.3] })) {
    if (allowed.includes(value?.[key])) result[key] = value[key];
  }
  for (const key of ['volume', 'musicVolume']) if (Number.isFinite(value?.[key])) result[key] = Math.min(100, Math.max(0, value[key]));
  if (['full', 'soft', 'off'].includes(value?.effects)) result.effects = value.effects;
  return result;
}
