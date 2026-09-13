// A deliberate lift across the hand edge is a play gesture. The packet's front
// edge matters, not whether the fingertip hits a small central rectangle.
export function isPlayIntent(rect, dx, dy, field, wasInside = false) {
  if(!field)return false;
  const lift=Math.max(28,Math.min(48,rect.height*.22))-(wasInside?8:0);
  const x=rect.left+rect.width/2+dx,y=rect.top+rect.height/2+dy;
  return dy<=-lift && rect.top+dy<=field.bottom+(wasInside?8:0) &&
    y>=field.top && x>=field.left && x<=field.right;
}
