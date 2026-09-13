// Positions share the same measured hand and card space. A larger preference
// may grow a short table; it never pushes a played card into the hover area.
export function tableLayout({ width, height, northBottom, sideEdge, sideHeight, hudBottom,
  handHeight, handBottom, cardWidth, captionHeight, narrow = false, compact = false, dense = false }) {
  if (compact) {
    const pileHeight = cardWidth * 1.5 + captionHeight + 6;
    const northTop = Math.max(northBottom, hudBottom) + 6;
    const minimumHeight = northTop + pileHeight + 6 + handHeight + handBottom;
    const tableHeight = Math.max(height,minimumHeight),handTop=tableHeight-handHeight-handBottom;
    return {minimumHeight,height:tableHeight,handTop,pileHeight,maxFanWidth:(width-60)/4,
      northTop,southTop:northTop,sideTop:northTop,sideSeatTop:44,west:width*.125,east:width*.875};
  }
  const gap = narrow ? dense ? 8 : 12 : 18;
  const pileHeight = cardWidth * 1.5 + captionHeight + 12;
  const maxFanWidth = Math.max(cardWidth, (width - (narrow ? 0 : sideEdge * 2) - gap * 4) / 3);
  const northTop = northBottom + gap;
  const sideSeatTop = narrow ? Math.max(hudBottom + gap, northTop) : null;
  const firstSouth = narrow ? Math.max(northTop + pileHeight + gap, sideSeatTop + sideHeight + gap) : northTop + pileHeight + gap;
  const handBoundary = Math.max(firstSouth + pileHeight + gap, hudBottom + sideHeight + gap * 2);
  const minimumHeight = Math.ceil(handBoundary + handHeight + handBottom);
  const tableHeight = Math.max(height, minimumHeight);
  const handTop = tableHeight - handHeight - handBottom;
  const southTop = handTop - gap - pileHeight;
  const sideTop = narrow ? southTop : (northTop + southTop) / 2;
  const west = narrow ? gap + maxFanWidth / 2 : sideEdge + gap + maxFanWidth / 2;
  return { minimumHeight, height: tableHeight, handTop, pileHeight, maxFanWidth,
    northTop, southTop, sideTop, sideSeatTop: sideSeatTop ?? Math.max(hudBottom + gap, Math.min(sideTop + (pileHeight - sideHeight) / 2, handTop - gap - sideHeight)),
    west, east: width - west };
}

export function fanOverlap(cardWidth, count, maxWidth, preferred = .25) {
  if (count < 2) return 0;
  return Math.max(cardWidth * preferred, (count * cardWidth - maxWidth) / (count - 1));
}

export function initialSceneScale(width, height, minimumWidth = 1280) {
  return Math.max(.05, Math.min(1.5, width / minimumWidth, height / 900));
}

export function fitScene(width, height, sceneWidth, sceneHeight) {
  const scale = Math.max(.001, Math.min(width / sceneWidth, height / sceneHeight));
  return { scale, left: (width - sceneWidth * scale) / 2, top: (height - sceneHeight * scale) / 2 };
}
