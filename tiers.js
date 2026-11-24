// 차트게임 티어: 잔고(실현 손익까지 반영된 현금) 기준 9단계. 기준을 넘으면 승급전(5판 3승)을 거쳐 오른다 (2026-11-24 기준값 조정).
// 엠블럼은 이 사이트에서 직접 그린 SVG (게임 회사 그림을 가져오지 않음). 색만 흔히 쓰는 티어 색 느낌으로.
const TIERS = [
  { key: 'iron',        name: '아이언',       en: 'IRON',         min: 0,        c1: '#8a817c', c2: '#3d3836', gem: '#b9b0aa' },
  { key: 'bronze',      name: '브론즈',       en: 'BRONZE',       min: 4000,     c1: '#cd8f5c', c2: '#5e3b22', gem: '#f0b483' },
  { key: 'silver',      name: '실버',         en: 'SILVER',       min: 6000,    c1: '#dfe6ee', c2: '#6f7c8a', gem: '#ffffff' },
  { key: 'gold',        name: '골드',         en: 'GOLD',         min: 10000,    c1: '#ffd966', c2: '#9a6a12', gem: '#fff1b8' },
  { key: 'platinum',    name: '플래티넘',     en: 'PLATINUM',     min: 15000,   c1: '#5fe0d2', c2: '#1b6e68', gem: '#c8fff8' },
  { key: 'diamond',     name: '다이아',       en: 'DIAMOND',      min: 30000,   c1: '#8fb4ff', c2: '#3442b8', gem: '#e3ecff' },
  { key: 'master',      name: '마스터',       en: 'MASTER',       min: 40000,  c1: '#d29bff', c2: '#5b1a96', gem: '#f3e1ff' },
  { key: 'grandmaster', name: '그랜드마스터', en: 'GRANDMASTER',  min: 50000,  c1: '#ff8a8a', c2: '#8f1515', gem: '#ffe0e0' },
  { key: 'challenger',  name: '챌린저',       en: 'CHALLENGER',   min: 100000, c1: '#ffe9a3', c2: '#2a8fd6', gem: '#e9fbff' },
];
function tierIndex(bal) { let i = 0; for (let k = 0; k < TIERS.length; k++) if (bal >= TIERS[k].min) i = k; return i; }

let tierSvgSeq = 0;
// 엠블럼 (직접 그린 SVG, 2026-11-24 다시 그림): 금속 질감 방패 + 깎은 보석.
// 단계가 오를수록 테두리 장식 → 날개 → 뿔 → 큰 날개 → 수정 조각 → 왕관·빛무리 → 칼날·불꽃 → 빛줄기·반짝임이 붙고, 다이아부터 빛이 스치고 지나간다.
function tierMix(hex, to, k) {              // hex 색을 to('#fff' 또는 '#000')쪽으로 k(0~1)만큼
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.length === 4 ? to.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3').slice(1) : to.slice(1), 16);
  const ch = (n, s) => (n >> s) & 255, m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k);
  return '#' + [16, 8, 0].map((s) => m(s).toString(16).padStart(2, '0')).join('');
}
function tierSvg(i, size = 64) {
  const t = TIERS[i], id = 'tg' + (++tierSvgSeq);
  const hi = tierMix(t.c1, '#fff', 0.55), lo = tierMix(t.c2, '#000', 0.45), mid = t.c1, dark = '#08080a';
  const P = [];
  // 뒤쪽: 빛무리(마스터+), 빛줄기(그랜드마스터+)
  if (i >= 6) P.push(`<circle cx="60" cy="62" r="58" fill="url(#${id}g)"/>`);
  if (i >= 7) {
    let rays = '';
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, a1 = a - 0.07, a2 = a + 0.07, r = k % 2 ? 50 : 60;
      rays += `<path d="M60 62 L${60 + Math.cos(a1) * r} ${62 + Math.sin(a1) * r} L${60 + Math.cos(a2) * r} ${62 + Math.sin(a2) * r} Z"/>`;
    }
    P.push(`<g fill="url(#${id}r)" opacity="${i === 8 ? 0.95 : 0.8}">${rays}</g>`);
  }
  // 날개 (실버+), 플래티넘부터 깃털 한 겹 더
  const wingL = (sc, dy) => `<path d="M38 ${50 + dy} C${26 - sc * 10} ${40 + dy - sc * 6}, ${10 - sc * 10} ${48 + dy}, ${4 - sc * 6} ${70 + dy + sc * 4} C${16 - sc * 4} ${64 + dy}, ${22} ${68 + dy}, 36 ${78 + dy} Z"/>`;
  const wings = (sc, dy, fill) => `<g fill="${fill}" stroke="${dark}" stroke-width="1.6" stroke-linejoin="round">${wingL(sc, dy)}<g transform="translate(120 0) scale(-1 1)">${wingL(sc, dy)}</g></g>`;
  if (i >= 4) P.push(wings(1.25, -6, `url(#${id}m)`));
  if (i >= 2) P.push(wings(i >= 4 ? 0.6 : 0.25, 2, `url(#${id}m)`));
  // 칼날 (그랜드마스터+) — 방패 뒤로 교차
  if (i >= 7) P.push(`<g stroke="${dark}" stroke-width="1.5" fill="url(#${id}m)"><path d="M22 18 L30 14 L82 92 L76 98 Z"/><path d="M98 18 L90 14 L38 92 L44 98 Z"/></g>`);
  // 옆 가시 (브론즈+)
  if (i >= 1) P.push(`<g fill="url(#${id}m)" stroke="${dark}" stroke-width="1.5"><path d="M24 40 L10 46 L26 54 Z"/><path d="M96 40 L110 46 L94 54 Z"/></g>`);
  // 뿔·왕관
  if (i >= 6) P.push(`<g stroke="${dark}" stroke-width="1.6" fill="url(#${id}m)"><path d="M36 26 L40 2 L50 16 L60 0 L70 16 L80 2 L84 26 Z"/></g>` +
    `<circle cx="60" cy="9" r="3.4" fill="${t.gem}" stroke="${dark}" stroke-width="1"/><circle cx="41" cy="11" r="2.4" fill="${t.gem}"/><circle cx="79" cy="11" r="2.4" fill="${t.gem}"/>`);
  else if (i >= 3) P.push(`<path d="M48 22 L60 2 L72 22 Z" fill="url(#${id}m)" stroke="${dark}" stroke-width="1.6"/>`);
  // 방패: 바깥 테두리 → 금속 → 안쪽 판
  P.push(`<path d="M60 12 L98 26 L94 74 Q86 94 60 110 Q34 94 26 74 L22 26 Z" fill="${dark}"/>`);
  P.push(`<path d="M60 15 L95 28 L91 73 Q83 91 60 106 Q37 91 29 73 L25 28 Z" fill="url(#${id}m)"/>`);
  P.push(`<path d="M60 15 L95 28 L91 73 Q83 91 60 106 Q37 91 29 73 L25 28 Z" fill="none" stroke="${hi}" stroke-width="1.2" opacity=".8"/>`);
  P.push(`<path d="M60 25 L85 35 L82 70 Q76 84 60 95 Q44 84 38 70 L35 35 Z" fill="url(#${id}p)" stroke="${lo}" stroke-width="1.5"/>`);
  // 리벳 (아이언·브론즈)
  if (i <= 1) P.push(`<g fill="${hi}" opacity=".85"><circle cx="40" cy="38" r="1.8"/><circle cx="80" cy="38" r="1.8"/><circle cx="44" cy="76" r="1.8"/><circle cx="76" cy="76" r="1.8"/></g>`);
  // 수정 조각 (다이아+)
  if (i >= 5) P.push(`<g stroke="${dark}" stroke-width="1" opacity=".95"><path d="M46 92 L52 84 L56 98 Z" fill="${t.gem}"/><path d="M74 92 L68 84 L64 98 Z" fill="${t.gem}"/></g>`);
  // 깎은 보석 (네 면 + 빛)
  const g = t.gem, gd = tierMix(t.c1, '#000', 0.25);
  P.push(`<g transform="translate(60 60)"><circle r="20" fill="url(#${id}gg)"/>` +
    `<path d="M0 -20 L14 0 L0 0 Z" fill="${tierMix(g, '#fff', 0.5)}"/><path d="M14 0 L0 24 L0 0 Z" fill="${gd}"/>` +
    `<path d="M0 24 L-14 0 L0 0 Z" fill="${mid}"/><path d="M-14 0 L0 -20 L0 0 Z" fill="${g}"/>` +
    `<path d="M0 -20 L14 0 L0 24 L-14 0 Z" fill="none" stroke="${dark}" stroke-width="1.6"/>` +
    `<path d="M-5 -9 L0 -15 L3 -10 Z" fill="#fff" opacity=".85"/></g>`);
  // 반짝임 (챌린저)
  if (i >= 8) {
    const star = (x, y, r) => `<path d="M${x} ${y - r} L${x + r * 0.25} ${y - r * 0.25} L${x + r} ${y} L${x + r * 0.25} ${y + r * 0.25} L${x} ${y + r} L${x - r * 0.25} ${y + r * 0.25} L${x - r} ${y} L${x - r * 0.25} ${y - r * 0.25} Z"/>`;
    P.push(`<g fill="#fff">${star(18, 22, 6)}${star(104, 30, 5)}${star(100, 96, 4)}${star(16, 92, 3.5)}</g>`);
  }
  // 빛이 스치고 지나감 (다이아+)
  const shine = i >= 5 ? `<path d="M60 15 L95 28 L91 73 Q83 91 60 106 Q37 91 29 73 L25 28 Z" fill="url(#${id}s)"/>` : '';
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" aria-label="${t.name}" style="overflow:visible"><defs>` +
    `<linearGradient id="${id}m" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".38" stop-color="${mid}"/><stop offset=".52" stop-color="${t.c2}"/><stop offset=".7" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></linearGradient>` +
    `<linearGradient id="${id}p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tierMix(t.c2, '#000', 0.55)}"/><stop offset="1" stop-color="${tierMix(t.c2, '#000', 0.8)}"/></linearGradient>` +
    `<radialGradient id="${id}g"><stop offset="0" stop-color="${t.c1}" stop-opacity=".7"/><stop offset=".6" stop-color="${t.c1}" stop-opacity=".18"/><stop offset="1" stop-color="${t.c1}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${id}r" cx="60" cy="62" r="60" gradientUnits="userSpaceOnUse"><stop offset=".3" stop-color="${i === 8 ? '#fff6d0' : hi}" stop-opacity=".9"/><stop offset="1" stop-color="${t.c1}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${id}gg"><stop offset="0" stop-color="${t.gem}" stop-opacity=".9"/><stop offset="1" stop-color="${t.gem}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0.4"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>` +
    `<animate attributeName="x1" values="-1;1" dur="3.2s" repeatCount="indefinite"/><animate attributeName="x2" values="0;2" dur="3.2s" repeatCount="indefinite"/></linearGradient>` +
    `</defs>${P.join('')}${shine}</svg>`;
}
