// One row: desktop scene coordinates, or a readable native-width phone strip.
export function handLayout(count, width, scale = 1, mobile = false, compact = false) {
  const n = Math.max(0, Math.floor(count)), available = Math.max(1, width);
  const cardWidth = Math.round((mobile ? compact ? 72 : 96 : available < 900 ? 88 : 108) * scale), cardHeight = cardWidth * 1.5;
  const padding = mobile ? 12 : Math.round(cardWidth * .82);
  const step = n > 1 ? mobile ? Math.max(44,cardWidth*.46) : Math.min(49 * scale, Math.max(29 * scale, (available - cardWidth - padding * 2) / (n - 1))) : 0;
  const span = n ? (n - 1) * step + cardWidth + padding * 2 : 0, offset = Math.max(padding, (available - span) / 2 + padding);
  return { rows: 1, cardWidth, cardHeight, step, contentWidth: Math.max(available, span),
    positions: Array.from({ length: n }, (_, index) => ({ left: offset + index * step, bottom: 0, width: index === n - 1 ? cardWidth : step })) };
}
