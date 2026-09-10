// Original lettering drawn as shapes, not converted from a font. The stepped
// terminals, shared cuts and layered edge give both titles the same signature.
const zh = [
  { x:0,y:8, d:'M24 5H36V15H32V23H28V31H23V38H17V45H9V52H0V40H6V35H12V28H17V20H21V12H24ZM42 4H52V12H55V20H59V28H64V35H70V40H76V52H66V49H59V44H53V38H48V30H45V23H43V14Z' },
  { x:88,y:5, d:'M27 0H41V21H63V24H69V35H41V58H38V64H27V35H4V32H0V21H27Z' },
  { x:170,y:0, d:'M25 0H38V8H33V15H25V22H14V27H3V18H13V13H20V7H25ZM43 0H55V7H60V13H68V18H77V24H66V29H59V24H51V18H47V12H43ZM16 32H67V57H64V66H43V56H52V43H38V48H33V55H26V63H15V69H4V59H14V53H20V47H24V43H16Z' },
];
const en = [
  {x:0,d:'M5 0H44V10H14V23H37V33H14V48H44V58H0V5H5Z'},
  {x:52,d:'M0 0H28V9H20V49H28V58H0V49H8V9H0Z'},
  {x:88,d:'M8 0H42V5H48V17H35V10H14V48H35V35H26V25H48V51H42V58H8V53H0V8H8Z'},
  {x:144,d:'M0 0H14V23H32V0H46V58H32V35H14V58H0Z'},
  {x:198,d:'M0 0H50V12H32V52H28V58H18V12H0Z'},
  {x:254,d:'M0 0H14V8H19V16H25V22H29V16H35V8H40V0H54V12H48V21H41V29H34V58H20V29H13V21H6V12H0Z'},
];
export function wordmark(language='zh') {
  const letters=language==='en'?en:zh,width=language==='en'?308:247,height=language==='en'?58:69;
  const shapes=letters.map(({x,y=0,d})=>`<path transform="translate(${x} ${y})" d="${d}"/>`).join('');
  const highlights=language==='en'?'M8 4H39M57 4H75M99 4H126M149 5V18M181 5V18M202 4H244M259 4H263M299 4H303':
    'M28 17H31M135 18V23M118 10H125M94 29H148M199 5H203M217 5H221M190 37H231';
  return `<svg class="wordmark wordmark-${language==='en'?'en':'zh'}" viewBox="-8 -7 ${width+25} ${height+26}" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><g class="wordmark-floor" transform="translate(7 9)">${shapes}</g><g class="wordmark-depth" transform="translate(3 4)">${shapes}</g><g class="wordmark-face">${shapes}</g><path class="wordmark-light" d="${highlights}"/><g class="wordmark-inlay">${language==='en'?'<path d="M20 48H42V53H20ZM284 44H288V54H284Z"/>':'<path d="M121 46H125V63H121ZM218 59H230V63H218Z"/>'}</g></svg>`;
}
