// One row in logical table coordinates; the scene camera fits the whole row.
export function handLayout(count, width, scale = 1) {
  const n = Math.max(0, Math.floor(count)), available = Math.max(1, width);
  const cardWidth = Math.round((available < 900 ? 88 : 108) * scale), cardHeight = cardWidth * 1.5;
  const padding = Math.round(cardWidth * .82);
  const step = n > 1 ? Math.min(49 * scale, Math.max(29 * scale, (available - cardWidth - padding * 2) / (n - 1))) : 0;
  const span = n ? (n - 1) * step + cardWidth + padding * 2 : 0, offset = Math.max(padding, (available - span) / 2 + padding);
  return { rows: 1, cardWidth, cardHeight, step, contentWidth: Math.max(available, span),
    positions: Array.from({ length: n }, (_, index) => ({ left: offset + index * step, bottom: 0, width: index === n - 1 ? cardWidth : step })) };
}
