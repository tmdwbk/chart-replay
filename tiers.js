// 차트게임 티어: 잔고(실현 손익까지 반영된 현금) 기준 9단계.
// 엠블럼은 이 사이트에서 직접 그린 SVG (게임 회사 그림을 가져오지 않음). 색만 흔히 쓰는 티어 색 느낌으로.
const TIERS = [
  { key: 'iron',        name: '아이언',       en: 'IRON',         min: 0,        c1: '#8a817c', c2: '#3d3836', gem: '#b9b0aa' },
  { key: 'bronze',      name: '브론즈',       en: 'BRONZE',       min: 5000,     c1: '#cd8f5c', c2: '#5e3b22', gem: '#f0b483' },
  { key: 'silver',      name: '실버',         en: 'SILVER',       min: 10000,    c1: '#dfe6ee', c2: '#6f7c8a', gem: '#ffffff' },
  { key: 'gold',        name: '골드',         en: 'GOLD',         min: 50000,    c1: '#ffd966', c2: '#9a6a12', gem: '#fff1b8' },
  { key: 'platinum',    name: '플래티넘',     en: 'PLATINUM',     min: 100000,   c1: '#5fe0d2', c2: '#1b6e68', gem: '#c8fff8' },
  { key: 'diamond',     name: '다이아',       en: 'DIAMOND',      min: 500000,   c1: '#8fb4ff', c2: '#3442b8', gem: '#e3ecff' },
  { key: 'master',      name: '마스터',       en: 'MASTER',       min: 1000000,  c1: '#d29bff', c2: '#5b1a96', gem: '#f3e1ff' },
  { key: 'grandmaster', name: '그랜드마스터', en: 'GRANDMASTER',  min: 5000000,  c1: '#ff8a8a', c2: '#8f1515', gem: '#ffe0e0' },
  { key: 'challenger',  name: '챌린저',       en: 'CHALLENGER',   min: 10000000, c1: '#ffe9a3', c2: '#2a8fd6', gem: '#e9fbff' },
];
function tierIndex(bal) { let i = 0; for (let k = 0; k < TIERS.length; k++) if (bal >= TIERS[k].min) i = k; return i; }

let tierSvgSeq = 0;
// 단계가 오를수록 날개·왕관·빛이 붙는 방패 엠블럼
function tierSvg(i, size = 64) {
  const t = TIERS[i], id = 'tg' + (++tierSvgSeq);
  const wing = (s) => `<path d="M30 40 C${18 - s * 6} ${36 - s * 2}, ${10 - s * 6} ${46 + s * 2}, ${6 - s * 4} ${62 + s * 4} C16 58, 22 60, 30 66 Z" fill="url(#${id}a)" stroke="${t.c2}" stroke-width="1.5"/>` +
    `<path d="M70 40 C${82 + s * 6} ${36 - s * 2}, ${90 + s * 6} ${46 + s * 2}, ${94 + s * 4} ${62 + s * 4} C84 58, 78 60, 70 66 Z" fill="url(#${id}a)" stroke="${t.c2}" stroke-width="1.5"/>`;
  const parts = [];
  if (i >= 7) parts.push(`<circle cx="50" cy="52" r="46" fill="url(#${id}g)"/>`);                       // 빛
  if (i >= 4) parts.push(wing(1)); else if (i >= 2) parts.push(wing(0));                                // 날개
  if (i >= 6) parts.push(`<path d="M34 22 L38 6 L44 16 L50 2 L56 16 L62 6 L66 22 Z" fill="url(#${id}a)" stroke="${t.c2}" stroke-width="1.5"/>`);   // 왕관
  else if (i >= 3) parts.push(`<path d="M42 20 L50 6 L58 20 Z" fill="url(#${id}a)" stroke="${t.c2}" stroke-width="1.5"/>`);                       // 뿔
  parts.push(`<path d="M50 14 L80 26 L76 64 L50 92 L24 64 L20 26 Z" fill="url(#${id}a)" stroke="${t.c2}" stroke-width="2"/>`);                  // 방패
  parts.push(`<path d="M50 24 L70 32 L67 61 L50 80 L33 61 L30 32 Z" fill="#141821" stroke="${t.c2}" stroke-width="1.5" opacity=".92"/>`);       // 안쪽
  parts.push(`<path d="M50 36 L60 50 L50 66 L40 50 Z" fill="${t.gem}" stroke="${t.c1}" stroke-width="1.5"/><path d="M50 36 L60 50 L50 50 Z" fill="#fff" opacity=".35"/>`); // 보석
  if (i >= 1) parts.push(`<path d="M30 70 L50 88 L70 70" fill="none" stroke="${t.c1}" stroke-width="2" opacity=".7"/>`);
  if (i >= 8) parts.push(`<circle cx="50" cy="8" r="3" fill="#fff"/><circle cx="12" cy="40" r="2" fill="#fff"/><circle cx="88" cy="40" r="2" fill="#fff"/>`);
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-label="${t.name}"><defs>` +
    `<linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.c1}"/><stop offset="1" stop-color="${t.c2}"/></linearGradient>` +
    `<radialGradient id="${id}g"><stop offset="0" stop-color="${t.c1}" stop-opacity=".55"/><stop offset="1" stop-color="${t.c1}" stop-opacity="0"/></radialGradient>` +
    `</defs>${parts.join('')}</svg>`;
}
